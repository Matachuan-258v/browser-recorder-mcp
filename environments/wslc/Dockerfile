ARG BASE_IMAGE=docker.1ms.run/ubuntu:24.04
FROM ${BASE_IMAGE}

# Windows/WSLC amd64 + D3D12 environment.
ARG NODE_VERSION=22.14.0
ARG CHROME_VERSION=153.0.8010.52-1
ARG APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/ubuntu/
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV DEBIAN_FRONTEND=noninteractive
RUN test "$(dpkg --print-architecture)" = amd64 \
 && sed -i "s|http://archive.ubuntu.com/ubuntu/|${APT_MIRROR}|g; s|http://security.ubuntu.com/ubuntu/|${APT_MIRROR}|g" /etc/apt/sources.list.d/ubuntu.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils tini weston libgl1-mesa-dri libegl-mesa0 mesa-utils ffmpeg \
 && curl -fL --retry 3 "https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_${CHROME_VERSION}_amd64.deb" -o /tmp/chrome.deb \
 && apt-get install -y --no-install-recommends /tmp/chrome.deb \
 && rm -f /tmp/chrome.deb \
 && rm -rf /var/lib/apt/lists/*
RUN cd /tmp \
 && curl -fLO --retry 3 "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
 && curl -fL --retry 3 "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o SHASUMS256.txt \
 && awk -v file="node-v${NODE_VERSION}-linux-x64.tar.xz" '$2 == file' SHASUMS256.txt > node.sha256 \
 && test -s node.sha256 && sha256sum -c node.sha256 \
 && mkdir -p /opt/node \
 && tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz" --strip-components=1 -C /opt/node \
 && rm -f node-v*-linux-x64.tar.xz SHASUMS256.txt node.sha256
ENV PATH=/opt/node/bin:$PATH
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --registry=${NPM_REGISTRY} && npm cache clean --force
COPY src/ ./src/
COPY extension/ ./extension/
COPY fixtures/ ./fixtures/
COPY test/ ./test/
COPY environments/wslc/entrypoint.sh /app/entrypoint.sh
COPY environments/wslc/smoke.sh /app/smoke.sh
ENV CHROME_PATH=/usr/bin/google-chrome
ENV GAME_DATA_DIR=/data
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=3000
EXPOSE 3000
ENV MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/bash", "/app/entrypoint.sh"]
CMD ["node", "/app/src/server.mjs"]
