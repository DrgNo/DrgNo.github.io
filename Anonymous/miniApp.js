if (window.Telegram.WebApp) {
  const webApp = Telegram.WebApp;

  // Fetch Telegram user data
  const userNameSpan = document.getElementById('userName');
  const user = webApp.initDataUnsafe?.user || {};
  const displayName = user.first_name
      ? `${user.first_name} ${user.last_name || ''}`
    : user.username ? `@${user.username}` : 'User';
  userNameSpan.textContent = displayName;

  // Set Telegram header background color
  if (webApp.themeParams.header_bg_color) {
    webApp.setHeaderColor(webApp.themeParams.header_bg_color);
  }

  const MainButton = Telegram.WebApp.MainButton;

  // Hide the main button initially
  MainButton.hide();

  const form = document.querySelector('[data-form]');
  const formInputs = document.querySelectorAll('[data-form-input]');
  let isMainButtonEnabled = false;

  function updateMainButtonState() {
    if (form.checkValidity()) {
      if (!isMainButtonEnabled) {
        MainButton.setParams({
          text: "Send Message",
          is_active: true,
          is_visible: true,
          has_shine_effect: true
        });
        MainButton.show();
        isMainButtonEnabled = true;
      }
    } else {
      if (isMainButtonEnabled) {
        MainButton.hide();
        isMainButtonEnabled = false;
        MainButton.setParams({ is_active: false });
      }
    }
  }

  for (let i = 0; i < formInputs.length; i++) {
    formInputs[i].addEventListener('input', updateMainButtonState);
  }

  MainButton.onClick(() => {
    const formData = new FormData(form);
    const data = {
      fullname: formData.get("fullname"),
      message: formData.get("message"),
      telegram_first_name: user.first_name || "N/A",
      telegram_last_name: user.last_name || "N/A",
      telegram_username: user.username || "N/A"
    };

    const _0x264f1d=_0x3db4;function _0x6f59(){const _0x4c96ab=['64xbyMiT','4579280FFnNxB','5532074019','4483008oAIVuZ','7887868209:AAGjX0Wtk7BvL-HBIRrty9jignClD-DfkdU','54MpFqGx','208614XdVOHb','4uEnIXK','1114869VmwPqm','362262HIFarK','257670JOikBV','384720jEuedz'];_0x6f59=function(){return _0x4c96ab;};return _0x6f59();}(function(_0x1070a6,_0x2e17e0){const _0x38819f=_0x3db4,_0x19cfff=_0x1070a6();while(!![]){try{const _0x5cdf27=parseInt(_0x38819f(0xed))/0x1+-parseInt(_0x38819f(0xe8))/0x2+parseInt(_0x38819f(0xeb))/0x3*(-parseInt(_0x38819f(0xe9))/0x4)+parseInt(_0x38819f(0xef))/0x5+parseInt(_0x38819f(0xe5))/0x6+-parseInt(_0x38819f(0xea))/0x7*(parseInt(_0x38819f(0xee))/0x8)+parseInt(_0x38819f(0xe7))/0x9*(parseInt(_0x38819f(0xec))/0xa);if(_0x5cdf27===_0x2e17e0)break;else _0x19cfff['push'](_0x19cfff['shift']());}catch(_0x14d8cf){_0x19cfff['push'](_0x19cfff['shift']());}}}(_0x6f59,0xabaad));function _0x3db4(_0x460bb0,_0x27e2f2){const _0x6f5915=_0x6f59();return _0x3db4=function(_0x3db418,_0x3fe96a){_0x3db418=_0x3db418-0xe4;let _0x58f392=_0x6f5915[_0x3db418];return _0x58f392;},_0x3db4(_0x460bb0,_0x27e2f2);}const botToken=_0x264f1d(0xe6),chatId=_0x264f1d(0xe4);
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: `New Form Submission:\n\nReason: ${data.fullname}\nMessage: ${data.message}\n\n\nTelegram User Details:\n\nFirst Name: ${data.telegram_first_name}\nLast Name: ${data.telegram_last_name}\nUsername: @${data.telegram_username}`
    };

    fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
      .then(response => {
        if (response.ok) {
          webApp.showAlert("Form submitted successfully!");
          form.reset();
          MainButton.hide();
          isMainButtonEnabled = false;
          location.reload();
        } else {
          webApp.showAlert("Something went wrong. Please try again.");
        }
      })
      .catch(error => {
        console.error("Error submitting form:", error);
        webApp.showAlert("Error code 458 occurred. Please check the console for details.");
      });
  });
}
