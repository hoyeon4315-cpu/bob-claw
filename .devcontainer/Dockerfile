FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm

# Python supports repo scripts such as graphify and the static dashboard server.
# curl/unzip are used to install Foundry, while build tooling helps npm native deps compile cleanly.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      pkg-config \
      python3 \
      python3-pip \
      python3-venv \
      unzip \
    && rm -rf /var/lib/apt/lists/*

# Wrangler is used by the Cloudflare Pages deploy helper.
RUN npm install -g wrangler@3

USER node

# Foundry is needed for the repo's forge-based contract tests and CLI tooling.
RUN curl -fsSL https://foundry.paradigm.xyz | bash \
    && /home/node/.foundry/bin/foundryup

ENV PATH="/home/node/.foundry/bin:${PATH}"
