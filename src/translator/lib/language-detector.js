// lib/language-detector.js - Detect Chinese Simplified vs Traditional + SEA Languages
// Adapted for content script (no ES modules)

(function() {
  'use strict';

  // ==================== SOUTHEAST ASIAN LANGUAGE DETECTION ====================

  // Thai script range: \u0E00-\u0E7F
  const THAI_REGEX = /[\u0E00-\u0E7F]/;

  // Indonesian common words (Bahasa Indonesia)
  const INDONESIAN_KEYWORDS = [
    'apa', 'ini', 'itu', 'dan', 'yang', 'untuk', 'dengan', 'tidak', 'dari', 'pada',
    'ke', 'di', 'ada', 'saya', 'kamu', 'anda', 'mereka', 'kami', 'kita', 'dia',
    'berapa', 'harga', 'bisa', 'mau', 'ingin', 'bagaimana', 'kapan', 'dimana', 'mengapa', 'siapa',
    'terima', 'kasih', 'tolong', 'silakan', 'maaf', 'permisi', 'selamat', 'pagi', 'siang', 'malam',
    'baik', 'bagus', 'murah', 'mahal', 'besar', 'kecil', 'banyak', 'sedikit', 'baru', 'lama',
    'beli', 'jual', 'bayar', 'kirim', 'pesan', 'order', 'produk', 'barang', 'stok', 'ready',
    'ongkir', 'gratis', 'diskon', 'promo', 'cod', 'transfer', 'rekening', 'alamat', 'nomor', 'hp',
    'boleh', 'sudah', 'belum', 'masih', 'juga', 'atau', 'tapi', 'kalau', 'karena', 'supaya'
  ];

  // Tagalog/Filipino common words
  const TAGALOG_KEYWORDS = [
    'ang', 'ng', 'sa', 'na', 'at', 'ay', 'ko', 'mo', 'ka', 'ako',
    'ikaw', 'siya', 'kami', 'tayo', 'sila', 'ito', 'iyan', 'iyon', 'dito', 'diyan',
    'magkano', 'ilan', 'ano', 'sino', 'saan', 'kailan', 'bakit', 'paano', 'alin', 'kanino',
    'salamat', 'po', 'opo', 'hindi', 'oo', 'pwede', 'puwede', 'gusto', 'kailangan', 'mahal',
    'mura', 'bili', 'benta', 'bayad', 'padala', 'order', 'produkto', 'item', 'available', 'stock',
    'libre', 'shipping', 'delivery', 'address', 'number', 'cellphone', 'gcash', 'paymaya',
    'kuya', 'ate', 'boss', 'mamser', 'mamsir', 'sis', 'bro', 'mare', 'pare', 'tol',
    'naman', 'lang', 'din', 'rin', 'nga', 'ba', 'kasi', 'eh', 'yung', 'yun'
  ];

  // ==================== CHINESE CHARACTER SETS ====================

  // Common characters that appear only in Simplified Chinese
  const SIMPLIFIED_ONLY = new Set([
    '这', '个', '来', '时', '们', '说', '国', '学', '从', '后',
    '电', '对', '问', '爱', '东', '开', '关', '还', '体', '间',
    '视', '网', '话', '万', '为', '书', '经', '种', '线', '点',
    '调', '车', '图', '应', '语', '场', '实', '现', '机', '样',
    '发', '么', '头', '变', '设', '达', '长', '门', '亲', '报',
    '数', '处', '边', '办', '义', '杂', '难', '厅', '观', '记',
    '联', '团', '标', '买', '业', '号', '专', '质', '声', '费',
    '价', '织', '师', '节', '干', '单', '证', '领', '总', '该',
    '鲜', '转', '农', '竞', '讲', '识', '题', '议', '选', '际',
    '济', '组', '练', '课', '认', '乐', '务', '区', '环', '职'
  ]);

  // Common characters that appear only in Traditional Chinese
  const TRADITIONAL_ONLY = new Set([
    '這', '個', '來', '時', '們', '說', '國', '學', '從', '後',
    '電', '對', '問', '愛', '東', '開', '關', '還', '體', '間',
    '視', '網', '話', '萬', '為', '書', '經', '種', '線', '點',
    '調', '車', '圖', '應', '語', '場', '實', '現', '機', '樣',
    '發', '麼', '頭', '變', '設', '達', '長', '門', '親', '報',
    '數', '處', '邊', '辦', '義', '雜', '難', '廳', '觀', '記',
    '聯', '團', '標', '買', '業', '號', '專', '質', '聲', '費',
    '價', '織', '師', '節', '幹', '單', '證', '領', '總', '該',
    '鮮', '轉', '農', '競', '講', '識', '題', '議', '選', '際',
    '濟', '組', '練', '課', '認', '樂', '務', '區', '環', '職'
  ]);

  /**
   * Detect language from text
   * @param {string} text - Text to analyze
   * @returns {string} - 'zh-TW' | 'zh-CN' | 'en' | 'vi' | 'id' | 'tl' | 'th'
   */
  function detectLanguage(text) {
    if (!text || typeof text !== 'string') {
      return 'zh-TW'; // Default to Traditional Chinese (Taiwan market)
    }

    const cleanText = text.trim();
    if (cleanText.length === 0) {
      return 'zh-TW';
    }

    // ==================== PRIORITY 1: Script-based detection (unambiguous) ====================

    // Check for Thai script first (unique alphabet)
    if (THAI_REGEX.test(cleanText)) {
      return 'th';
    }

    // Vietnamese-specific characters (unique diacritics)
    const vietnameseChars = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    if (vietnameseChars.test(cleanText)) {
      return 'vi';
    }

    // ==================== PRIORITY 2: Chinese character detection ====================

    let simplifiedCount = 0;
    let traditionalCount = 0;
    let chineseCount = 0;
    let englishCount = 0;

    for (const char of cleanText) {
      if (SIMPLIFIED_ONLY.has(char)) {
        simplifiedCount++;
        chineseCount++;
      } else if (TRADITIONAL_ONLY.has(char)) {
        traditionalCount++;
        chineseCount++;
      } else if (/[\u4e00-\u9fff]/.test(char)) {
        chineseCount++;
      } else if (/[a-zA-Z]/.test(char)) {
        englishCount++;
      }
    }

    // If Chinese characters detected, determine variant
    if (chineseCount > 0) {
      if (traditionalCount > simplifiedCount) {
        return 'zh-TW';
      } else if (simplifiedCount > traditionalCount) {
        return 'zh-CN';
      }
      return 'zh-TW'; // Default to Traditional
    }

    // ==================== PRIORITY 3: Keyword-based detection (Latin alphabet languages) ====================

    const lowerText = cleanText.toLowerCase();
    const words = lowerText.split(/\s+/);

    // Count keyword matches
    let indonesianMatches = 0;
    let tagalogMatches = 0;

    for (const word of words) {
      // Remove punctuation for matching
      const cleanWord = word.replace(/[.,!?;:'"()]/g, '');

      if (INDONESIAN_KEYWORDS.includes(cleanWord)) {
        indonesianMatches++;
      }
      if (TAGALOG_KEYWORDS.includes(cleanWord)) {
        tagalogMatches++;
      }
    }

    // Need at least 1 match and decent confidence
    const minMatches = 1;

    // Indonesian detection
    if (indonesianMatches >= minMatches && indonesianMatches >= tagalogMatches) {
      // Additional check: Indonesian-specific patterns
      if (indonesianMatches > tagalogMatches ||
          /\b(nya|kan|lah|kah)\b/i.test(lowerText) ||
          /\b(ber|me|ter|di|ke)[a-z]+/i.test(lowerText)) {
        return 'id';
      }
    }

    // Tagalog detection
    if (tagalogMatches >= minMatches && tagalogMatches > indonesianMatches) {
      return 'tl';
    }

    // If tied and both have matches, check for unique patterns
    if (indonesianMatches > 0 && tagalogMatches > 0 && indonesianMatches === tagalogMatches) {
      // Tagalog-specific: "po", "opo", "ng", "mga"
      if (/\b(po|opo|mga)\b/i.test(lowerText)) {
        return 'tl';
      }
      // Indonesian-specific: suffix -nya, -kan, -lah
      if (/\b\w+(nya|kan|lah)\b/i.test(lowerText)) {
        return 'id';
      }
    }

    // ==================== PRIORITY 4: Fallback ====================

    const totalChars = cleanText.replace(/\s/g, '').length;

    // If mostly English letters, return English
    if (englishCount > totalChars * 0.5) {
      return 'en';
    }

    // Default to Traditional Chinese (Taiwan is primary market)
    return 'zh-TW';
  }

  /**
   * Get language display info
   * @param {string} langCode - Language code
   * @returns {object} - Language info with icon, name, etc.
   */
  function getLanguageInfo(langCode) {
    const languages = {
      'zh-TW': {
        code: 'zh-TW',
        name: '繁體中文',
        nameVi: 'Tiếng Trung phồn thể',
        nameEn: 'Traditional Chinese',
        flag: '🇹🇼',
        region: 'Đài Loan / Taiwan'
      },
      'zh-CN': {
        code: 'zh-CN',
        name: '简体中文',
        nameVi: 'Tiếng Trung giản thể',
        nameEn: 'Simplified Chinese',
        flag: '🇨🇳',
        region: 'Trung Quốc / China'
      },
      'en': {
        code: 'en',
        name: 'English',
        nameVi: 'Tiếng Anh',
        nameEn: 'English',
        flag: '🇬🇧',
        region: 'Global'
      },
      'vi': {
        code: 'vi',
        name: 'Tiếng Việt',
        nameVi: 'Tiếng Việt',
        nameEn: 'Vietnamese',
        flag: '🇻🇳',
        region: 'Việt Nam'
      },
      'id': {
        code: 'id',
        name: 'Bahasa Indonesia',
        nameVi: 'Tiếng Indonesia',
        nameEn: 'Indonesian',
        flag: '🇮🇩',
        region: 'Indonesia'
      },
      'tl': {
        code: 'tl',
        name: 'Tagalog',
        nameVi: 'Tiếng Tagalog/Filipino',
        nameEn: 'Tagalog/Filipino',
        flag: '🇵🇭',
        region: 'Philippines'
      },
      'th': {
        code: 'th',
        name: 'ภาษาไทย',
        nameVi: 'Tiếng Thái',
        nameEn: 'Thai',
        flag: '🇹🇭',
        region: 'Thailand'
      }
    };

    return languages[langCode] || languages['zh-TW'];
  }

  // Expose to global scope
  window.detectLanguage = detectLanguage;
  window.getLanguageInfo = getLanguageInfo;

})();
