#!/usr/bin/env bash
set -euo pipefail

REPO="3kaiu/opencode-x"
BIN_NAME="opencodex"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

if [[ "${OSTYPE}" != "darwin"* ]] || [[ "$(uname -m)" != "arm64" ]]; then
  echo "Only macOS arm64 is supported." >&2
  exit 1
fi

echo "Fetching latest release from ${REPO}..."
LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
echo "Latest version: ${LATEST}"

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST}/opencode-darwin-arm64.tar.gz"
TMPDIR=$(mktemp -d)
trap 'rm -rf "${TMPDIR}"' EXIT

echo "Downloading ${DOWNLOAD_URL}..."
curl -fsSL "${DOWNLOAD_URL}" -o "${TMPDIR}/opencode.tar.gz"
tar xzf "${TMPDIR}/opencode.tar.gz" -C "${TMPDIR}"

echo "Installing ${BIN_NAME} to ${INSTALL_DIR}..."
install -d "${INSTALL_DIR}"
install "${TMPDIR}/${BIN_NAME}" "${INSTALL_DIR}/${BIN_NAME}"

echo "Installed ${BIN_NAME} ${LATEST} to ${INSTALL_DIR}/${BIN_NAME}"
