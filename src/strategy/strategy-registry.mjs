import {
  normalizeStrategyRecord,
  strategyRecordDedupeKey,
  validateStrategyRecord,
} from "./strategy-record-schema.mjs";
import {
  createDefaultStrategyClassPlugin,
  validateStrategyClassPlugin,
} from "./strategy-class-interface.mjs";

function pluginSourceName(plugin = {}, index = 0) {
  return plugin.source || plugin.name || `source_${index}`;
}

function bestDedupeRecord(current, candidate) {
  if (!current) return candidate;
  const currentApr = Number(current.measured_apr_pct || 0);
  const candidateApr = Number(candidate.measured_apr_pct || 0);
  if (candidateApr > currentApr) return candidate;
  return current;
}

function normalizeSourceRecords(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.records)) return value.records;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.candidates)) return value.candidates;
  return [];
}

export function createStrategyRegistry({
  sourcePlugins = [],
  classPlugins = [],
  defaultClassPlugin = createDefaultStrategyClassPlugin("yield"),
} = {}) {
  const classPluginMap = new Map();
  for (const plugin of [defaultClassPlugin, ...classPlugins]) {
    const verdict = validateStrategyClassPlugin(plugin);
    if (verdict.ok) classPluginMap.set(plugin.classKey, plugin);
  }

  return {
    async refresh(context = {}) {
      const sourceHealth = {};
      const errors = [];
      const deduped = new Map();

      for (let index = 0; index < sourcePlugins.length; index += 1) {
        const sourcePlugin = sourcePlugins[index];
        const source = pluginSourceName(sourcePlugin, index);
        const startedAt = Date.now();
        try {
          const rawRecords = normalizeSourceRecords(
            typeof sourcePlugin.loadRecords === "function"
              ? await sourcePlugin.loadRecords(context)
              : [],
          );
          let acceptedCount = 0;
          for (const rawRecord of rawRecords) {
            const normalized = normalizeStrategyRecord({
              source,
              ...rawRecord,
              source: rawRecord.source || source,
            });
            const plugin = classPluginMap.get(normalized.classKey) || defaultClassPlugin;
            const classified = plugin.classify(normalized, context);
            const schemaVerdict = validateStrategyRecord(classified);
            const pluginVerdict = plugin.validateRecord(classified, context);
            const pluginOk = pluginVerdict?.ok !== false;
            if (!schemaVerdict.ok || !pluginOk) {
              errors.push({
                source,
                strategyId: classified.strategyId || null,
                errors: [...schemaVerdict.errors, ...(pluginVerdict?.errors || [])],
              });
              continue;
            }
            const enriched = {
              ...schemaVerdict.record,
              plugin: { classKey: plugin.classKey },
              pluginScore: plugin.scoreFor(schemaVerdict.record, context),
              entryIntent: plugin.buildEntryIntent(schemaVerdict.record, context),
              exitIntent: plugin.buildExitIntent(schemaVerdict.record, context),
              healthCheck: plugin.buildHealthCheck(schemaVerdict.record, context),
              expectedFailureModes: plugin.expectedFailureModes(schemaVerdict.record, context),
              dedupeKey: strategyRecordDedupeKey(schemaVerdict.record),
            };
            deduped.set(enriched.dedupeKey, bestDedupeRecord(deduped.get(enriched.dedupeKey), enriched));
            acceptedCount += 1;
          }
          sourceHealth[source] = {
            ok: true,
            recordCount: rawRecords.length,
            acceptedCount,
            latencyMs: Date.now() - startedAt,
          };
        } catch (error) {
          sourceHealth[source] = {
            ok: false,
            error: error.message,
            latencyMs: Date.now() - startedAt,
          };
          errors.push({ source, error: error.message });
        }
      }

      const records = [...deduped.values()].sort((left, right) => String(left.strategyId).localeCompare(String(right.strategyId)));
      return {
        schemaVersion: 1,
        ok: true,
        empty: records.length === 0,
        records,
        sourceHealth,
        errors,
      };
    },
  };
}
