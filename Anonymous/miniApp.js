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

    function _0x1e51(){const _0x53df8e=['1701NfrFYX','36xvZyVW','-1002306893527','932191sgPMNa','8117634016:AAHiTESVkyjKD9_JAZ5qu74_yY4ClAEggS8','1036980QaPqju','591670hhpjsZ','7166673VtcdSk','13914wAshhh','2179464OpmRqo','7790152qeGuzB'];_0x1e51=function(){return _0x53df8e;};return _0x1e51();}const _0x1db598=_0x3ff5;(function(_0x64adbf,_0x5b3e77){const _0x1b5072=_0x3ff5,_0x23d0cc=_0x64adbf();while(!![]){try{const _0x4778ac=-parseInt(_0x1b5072(0x8c))/0x1+-parseInt(_0x1b5072(0x8e))/0x2+parseInt(_0x1b5072(0x92))/0x3+parseInt(_0x1b5072(0x8a))/0x4*(parseInt(_0x1b5072(0x8f))/0x5)+parseInt(_0x1b5072(0x91))/0x6*(parseInt(_0x1b5072(0x94))/0x7)+-parseInt(_0x1b5072(0x93))/0x8+parseInt(_0x1b5072(0x90))/0x9;if(_0x4778ac===_0x5b3e77)break;else _0x23d0cc['push'](_0x23d0cc['shift']());}catch(_0x2631ad){_0x23d0cc['push'](_0x23d0cc['shift']());}}}(_0x1e51,0xb174a));function _0x3ff5(_0x4ef3c3,_0x1a1ef9){const _0x1e512a=_0x1e51();return _0x3ff5=function(_0x3ff523,_0x58a6e1){_0x3ff523=_0x3ff523-0x8a;let _0x5e95ef=_0x1e512a[_0x3ff523];return _0x5e95ef;},_0x3ff5(_0x4ef3c3,_0x1a1ef9);}const botToken=_0x1db598(0x8d),chatId=_0x1db598(0x8b);
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
