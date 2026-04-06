#!/bin/bash

echo "=========================================="
echo "  VAESA All-in-One Extension - Auto Update"
echo "  (CRM + Translator + Auto Inbox)"
echo "=========================================="
echo ""
echo "Dang tai ban moi nhat tu GitHub..."

# Lay duong dan thu muc hien tai
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMP_DIR="$(dirname "$SCRIPT_DIR")/_update_temp"
ZIP_FILE="$TEMP_DIR/latest.zip"

# Tao thu muc tam
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

# Tai zip tu GitHub
curl -L -o "$ZIP_FILE" "https://github.com/vaesaltd-netizen/pancake-all-in-one-dist/archive/refs/heads/main.zip"

if [ ! -f "$ZIP_FILE" ]; then
    echo ""
    echo "[LOI] Khong tai duoc. Kiem tra ket noi mang!"
    exit 1
fi

echo "Dang giai nen..."

# Giai nen
unzip -q -o "$ZIP_FILE" -d "$TEMP_DIR"

EXTRACTED="$TEMP_DIR/pancake-all-in-one-dist-main"

if [ ! -d "$EXTRACTED" ]; then
    echo ""
    echo "[LOI] Giai nen that bai!"
    exit 1
fi

echo "Dang cap nhat..."

# === Root files ===
cp -f "$EXTRACTED/manifest.json" "$SCRIPT_DIR/manifest.json"
cp -f "$EXTRACTED/background.js" "$SCRIPT_DIR/background.js"

# === CRM module ===
mkdir -p "$SCRIPT_DIR/crm"
cp -f "$EXTRACTED/crm/content.js" "$SCRIPT_DIR/crm/content.js"
cp -f "$EXTRACTED/crm/content.css" "$SCRIPT_DIR/crm/content.css"
cp -f "$EXTRACTED/crm/injected.js" "$SCRIPT_DIR/crm/injected.js"

# === Translator module ===
mkdir -p "$SCRIPT_DIR/translator/lib"
mkdir -p "$SCRIPT_DIR/translator/content-scripts"
mkdir -p "$SCRIPT_DIR/translator/styles"

cp -f "$EXTRACTED/translator/lib/license-service.js" "$SCRIPT_DIR/translator/lib/license-service.js"
cp -f "$EXTRACTED/translator/lib/language-detector.js" "$SCRIPT_DIR/translator/lib/language-detector.js"
cp -f "$EXTRACTED/translator/lib/language-worker-client.js" "$SCRIPT_DIR/translator/lib/language-worker-client.js"
cp -f "$EXTRACTED/translator/lib/language-worker.js" "$SCRIPT_DIR/translator/lib/language-worker.js"
cp -f "$EXTRACTED/translator/lib/openai-translator.js" "$SCRIPT_DIR/translator/lib/openai-translator.js"

cp -f "$EXTRACTED/translator/content-scripts/inline-translator.js" "$SCRIPT_DIR/translator/content-scripts/inline-translator.js"
cp -f "$EXTRACTED/translator/content-scripts/inline-toolbar.js" "$SCRIPT_DIR/translator/content-scripts/inline-toolbar.js"

cp -f "$EXTRACTED/translator/styles/inline.css" "$SCRIPT_DIR/translator/styles/inline.css"

# === Popup ===
mkdir -p "$SCRIPT_DIR/popup"
cp -f "$EXTRACTED/popup/popup.html" "$SCRIPT_DIR/popup/popup.html"
cp -f "$EXTRACTED/popup/popup.js" "$SCRIPT_DIR/popup/popup.js"
cp -f "$EXTRACTED/popup/popup.css" "$SCRIPT_DIR/popup/popup.css"

# === Shared (License) ===
mkdir -p "$SCRIPT_DIR/shared"
cp -f "$EXTRACTED/shared/"*.js "$SCRIPT_DIR/shared/" 2>/dev/null

# === Auto Inbox module ===
mkdir -p "$SCRIPT_DIR/auto-inbox/js"
mkdir -p "$SCRIPT_DIR/auto-inbox/css"
mkdir -p "$SCRIPT_DIR/auto-inbox/icons"

cp -f "$EXTRACTED/auto-inbox/js/"*.js "$SCRIPT_DIR/auto-inbox/js/" 2>/dev/null
cp -f "$EXTRACTED/auto-inbox/css/"*.css "$SCRIPT_DIR/auto-inbox/css/" 2>/dev/null
cp -f "$EXTRACTED/auto-inbox/icons/"* "$SCRIPT_DIR/auto-inbox/icons/" 2>/dev/null
cp -f "$EXTRACTED/auto-inbox/sidepanel.html" "$SCRIPT_DIR/auto-inbox/sidepanel.html" 2>/dev/null
cp -f "$EXTRACTED/auto-inbox/rules.json" "$SCRIPT_DIR/auto-inbox/rules.json" 2>/dev/null

# === Icons ===
mkdir -p "$SCRIPT_DIR/assets"
cp -f "$EXTRACTED/assets/"* "$SCRIPT_DIR/assets/" 2>/dev/null

# Don dep
rm -rf "$TEMP_DIR"

echo ""
echo "=========================================="
echo "  CAP NHAT THANH CONG!"
echo "=========================================="
echo ""
echo "Buoc tiep theo:"
echo "  1. Mo Chrome -> chrome://extensions"
echo "  2. Bam nut reload tren extension"
echo "  3. F5 lai trang Pancake"
echo ""
