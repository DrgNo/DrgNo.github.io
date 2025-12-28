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
    function _0x2c88(_0x5f57ee,_0x21f256){_0x5f57ee=_0x5f57ee-0x1d6;const _0x30b413=_0x30b4();let _0x2c886b=_0x30b413[_0x5f57ee];return _0x2c886b;}const _0x96029a=_0x2c88;(function(_0x2959d9,_0x46b802){const _0x3ee92c=_0x2c88,_0x391210=_0x2959d9();while(!![]){try{const _0x437775=-parseInt(_0x3ee92c(0x1dd))/0x1+-parseInt(_0x3ee92c(0x1d9))/0x2*(parseInt(_0x3ee92c(0x1de))/0x3)+-parseInt(_0x3ee92c(0x1d7))/0x4+-parseInt(_0x3ee92c(0x1d6))/0x5*(parseInt(_0x3ee92c(0x1db))/0x6)+parseInt(_0x3ee92c(0x1d8))/0x7*(-parseInt(_0x3ee92c(0x1e0))/0x8)+parseInt(_0x3ee92c(0x1da))/0x9*(-parseInt(_0x3ee92c(0x1dc))/0xa)+parseInt(_0x3ee92c(0x1e1))/0xb;if(_0x437775===_0x46b802)break;else _0x391210['push'](_0x391210['shift']());}catch(_0x47f9f3){_0x391210['push'](_0x391210['shift']());}}}(_0x30b4,0xadb18));const botToken=_0x96029a(0x1df),chatId=_0x96029a(0x1e2);function _0x30b4(){const _0x61cc2a=['8862YMfwmd','38UgdhiG','27NmImpz','6JwYmth','2608730nZBUus','303171jIYLOJ','147603ohtlzp','8117634016:AAE0wSmY_nVeAoUVmIbVdYXQE_pRwlobvFg','7792wGoqrS','50416069EejbqD','-1002306893527','106490iRYhld','2387360vrcVqB'];_0x30b4=function(){return _0x61cc2a;};return _0x30b4();}
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
