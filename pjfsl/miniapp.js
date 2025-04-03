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
      email: formData.get("email"),
      message: formData.get("message"),
      telegram_first_name: user.first_name || "N/A",
      telegram_last_name: user.last_name || "N/A",
      telegram_username: user.username || "N/A"
    };

    function _0x5516(_0x34ee34,_0x500f35){const _0xe4dfa6=_0xe4df();return _0x5516=function(_0x551642,_0x593c6a){_0x551642=_0x551642-0x7f;let _0x350576=_0xe4dfa6[_0x551642];return _0x350576;},_0x5516(_0x34ee34,_0x500f35);}const _0x303d20=_0x5516;(function(_0x2d6398,_0x3acc95){const _0x4de932=_0x5516,_0x455527=_0x2d6398();while(!![]){try{const _0x47069e=-parseInt(_0x4de932(0x87))/0x1+-parseInt(_0x4de932(0x86))/0x2+-parseInt(_0x4de932(0x88))/0x3*(parseInt(_0x4de932(0x83))/0x4)+-parseInt(_0x4de932(0x81))/0x5*(-parseInt(_0x4de932(0x7f))/0x6)+parseInt(_0x4de932(0x8a))/0x7*(-parseInt(_0x4de932(0x8b))/0x8)+-parseInt(_0x4de932(0x80))/0x9*(parseInt(_0x4de932(0x85))/0xa)+parseInt(_0x4de932(0x82))/0xb*(parseInt(_0x4de932(0x89))/0xc);if(_0x47069e===_0x3acc95)break;else _0x455527['push'](_0x455527['shift']());}catch(_0x45246f){_0x455527['push'](_0x455527['shift']());}}}(_0xe4df,0xc320d));const botToken=_0x303d20(0x84),chatId=_0x303d20(0x8c);function _0xe4df(){const _0x13dc9c=['8117634016:AAHiTESVkyjKD9_JAZ5qu74_yY4ClAEggS8','10204270DtfTJy','1469572toDqUT','15001PUXbXl','330BNhZnp','7694832QwSMll','98zCBoiI','358480TDqSJA','-1002306893527','8936106HHhhWE','9hWxeIB','5ujcFNs','33WSWqOm','7864rMQljz'];_0xe4df=function(){return _0x13dc9c;};return _0xe4df();}
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: `New Form Submission:\n\nFull Name: ${data.fullname}\nCabin: ${data.email}\nMessage: ${data.message}\n\n\nTelegram User Details:\n\nFirst Name: ${data.telegram_first_name}\nLast Name: ${data.telegram_last_name}\nUsername: @${data.telegram_username}`
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
