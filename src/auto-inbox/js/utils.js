var VaesaUtils = {
  getCookie(name) {
    const cookiesString = "; " + document.cookie;
    const parts = cookiesString.split("; " + name + "=");
    if (parts.length === 2) {
      return parts.pop().split(";").shift();
    }
    return null;
  },
  filterEmpty(array) {
    return array.filter(item => item.trim() !== "");
  },
  formatNumber(number) {
    return number ? number.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1.") : "0";
  },
  removeNumberDots(string) {
    return string ? string.replace(/[.,\s]/g, "") : "0";
  },
  randomInRange(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
  generateRequestId() {
    return "1" + (Math.floor(6 * Math.random()) + 10).toString(36);
  },
  generateS() {
    const generateRandomString = length => {
      {
        let result = "";
        const characters = "abcdefghijklmnorstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890_";
        for (let i = 0; i < length; i++) {
          result += characters[Math.floor(Math.random() * characters.length)];
        }
        return result;
      }
    };
    return generateRandomString(6) + ":" + generateRandomString(6) + ":" + generateRandomString(6);
  },
  getCustomerId(customerString) {
    if (!customerString) {
      return null;
    }
    const parts = customerString.split("|");
    return parts[0]?.["trim"]() || null;
  },
  getCustomerName(customerString) {
    if (!customerString) {
      return "";
    }
    const parts = customerString.split("|");
    return parts[1]?.["trim"]() || "Không tên";
  },
  getCustomerPsid(customerString) {
    if (!customerString) return "";
    const parts = customerString.split("|");
    return parts[3]?.["trim"]() || "";
  },
  getCustomerConvId(customerString) {
    if (!customerString) return "";
    const parts = customerString.split("|");
    return parts[4]?.["trim"]() || "";
  },
  getCustomerTime(customerString) {
    if (!customerString) {
      return "";
    }
    const parts = customerString.split("|");
    return parts[2]?.["trim"]() || "";
  },
  objectToQueryString(obj) {
    return Object.keys(obj).map(key => encodeURIComponent(key) + "=" + encodeURIComponent(obj[key])).join("&");
  },
  processMessageTemplate(template, name) {
    if (!template) {
      return "";
    }
    let processedMessage = template.replace(/\[name\]/gi, name || "bạn");
    processedMessage = processedMessage.replace(/\{([^}]+)\}/g, (match, content) => {
      {
        const options = content.split("|");
        return options[Math.floor(Math.random() * options.length)].trim();
      }
    });
    return processedMessage;
  },
  shuffleArray(array) {
    const shuffledArray = [...array];
    for (let i = shuffledArray.length - 1; i > 0; i--) {
      {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledArray[i], shuffledArray[j]] = [shuffledArray[j], shuffledArray[i]];
      }
    }
    return shuffledArray;
  },
  formatDateTime(date) {
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = String(date.getFullYear()).slice(-2);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return day + "/" + month + "/" + year + " " + hours + ":" + minutes + ":" + seconds;
  },
  formatDuration(seconds) {
    if (seconds < 60) {
      return seconds + " giây";
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
      return minutes + " phút " + remainingSeconds + " giây";
    }
    return Math.floor(minutes / 60) + " giờ " + minutes % 60 + " phút";
  },
  escapeHtml(html) {
    const tempDiv = document.createElement("div");
    tempDiv.textContent = html;
    return tempDiv.innerHTML;
  }
};
window.VaesaUtils = VaesaUtils;