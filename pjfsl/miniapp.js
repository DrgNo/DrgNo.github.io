// Username Fetching
const userNameSpan = document.getElementById('userName');

        if (Telegram.WebApp && Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user) {
            const user = Telegram.WebApp.initDataUnsafe.user;
            const firstName = user.first_name || '';
            const lastName = user.last_name || '';
            const username = user.username || '';

            let displayName = '';

            if (firstName && lastName) {
                displayName = `${firstName} ${lastName}`;
            } else if (firstName) {
                displayName = firstName;
            } else if (username) {
                displayName = `@${username}`;
            } else {
                displayName = 'User'; // Default if no info is available
            }

            userNameSpan.textContent = displayName;
        } else {
            userNameSpan.textContent = 'User'; // Handle cases outside Telegram Mini App
        }


//Set header Background
const webApp = window.Telegram.WebApp;

// Set header background color
if (webApp.themeParams.header_bg_color) {
  webApp.setHeaderColor(webApp.themeParams.header_bg_color);
}


// Form activating

const _0x182ec0=_0x3523;(function(_0x10477e,_0x4208d1){const _0x5048c9=_0x3523,_0x5e8c86=_0x10477e();while(!![]){try{const _0x260483=parseInt(_0x5048c9(0x194))/0x1+-parseInt(_0x5048c9(0x186))/0x2*(-parseInt(_0x5048c9(0x181))/0x3)+-parseInt(_0x5048c9(0x184))/0x4+-parseInt(_0x5048c9(0x191))/0x5*(parseInt(_0x5048c9(0x18a))/0x6)+parseInt(_0x5048c9(0x193))/0x7*(parseInt(_0x5048c9(0x19c))/0x8)+parseInt(_0x5048c9(0x17e))/0x9*(-parseInt(_0x5048c9(0x1a1))/0xa)+parseInt(_0x5048c9(0x1a2))/0xb;if(_0x260483===_0x4208d1)break;else _0x5e8c86['push'](_0x5e8c86['shift']());}catch(_0x357b18){_0x5e8c86['push'](_0x5e8c86['shift']());}}}(_0x48c8,0xced84));if(window[_0x182ec0(0x188)]['WebApp']){const MainButton=Telegram['WebApp']['MainButton'];MainButton[_0x182ec0(0x195)]();const form=document[_0x182ec0(0x19b)](_0x182ec0(0x185)),formInputs=document[_0x182ec0(0x197)]('[data-form-input]');let isMainButtonEnabled=![];function updateMainButtonState(){const _0x156cd7=_0x182ec0;form['checkValidity']()?!isMainButtonEnabled&&(MainButton[_0x156cd7(0x19f)](_0x156cd7(0x18e)),MainButton[_0x156cd7(0x189)](),isMainButtonEnabled=!![],MainButton[_0x156cd7(0x19e)]({'text':_0x156cd7(0x192),'is_active':!![],'is_visible':!![],'has_shine_effect':!![]})):isMainButtonEnabled&&(MainButton['hide'](),isMainButtonEnabled=![],MainButton[_0x156cd7(0x19e)]({'is_active':![]}));}for(let i=0x0;i<formInputs['length'];i++){formInputs[i][_0x182ec0(0x19d)]('input',updateMainButtonState);}MainButton['onClick'](()=>{const _0xcfbf0b=_0x182ec0,_0x21e7a7=new FormData(form),_0x32585b={'fullname':_0x21e7a7['get']('fullname'),'email':_0x21e7a7[_0xcfbf0b(0x18d)]('email'),'message':_0x21e7a7[_0xcfbf0b(0x18d)](_0xcfbf0b(0x17b))},_0xd4bf16=_0xcfbf0b(0x17f),_0x23554b='-1002306893527',_0x396bf1='https://api.telegram.org/bot'+_0xd4bf16+_0xcfbf0b(0x180),_0x4281c0={'chat_id':_0x23554b,'text':_0xcfbf0b(0x17c)+_0x32585b['fullname']+_0xcfbf0b(0x18b)+_0x32585b[_0xcfbf0b(0x183)]+_0xcfbf0b(0x19a)+_0x32585b[_0xcfbf0b(0x17b)]};fetch(_0x396bf1,{'method':'POST','headers':{'Content-Type':_0xcfbf0b(0x187)},'body':JSON[_0xcfbf0b(0x18f)](_0x4281c0)})['then'](_0x53275b=>{const _0x3cf2b8=_0xcfbf0b;_0x53275b['ok']?(Telegram['WebApp'][_0x3cf2b8(0x182)](_0x3cf2b8(0x18c)),form[_0x3cf2b8(0x1a0)](),MainButton['hide'](),isMainButtonEnabled=![],location[_0x3cf2b8(0x17a)]()):Telegram[_0x3cf2b8(0x17d)][_0x3cf2b8(0x182)](_0x3cf2b8(0x196));})['catch'](_0x1500d5=>{const _0x27f3a7=_0xcfbf0b;console[_0x27f3a7(0x198)](_0x27f3a7(0x199),_0x1500d5),Telegram[_0x27f3a7(0x17d)]['showAlert'](_0x27f3a7(0x190));});});}function _0x3523(_0x25c4d6,_0x54e33d){const _0x48c89c=_0x48c8();return _0x3523=function(_0x3523c0,_0x2aa1ab){_0x3523c0=_0x3523c0-0x17a;let _0x4284ee=_0x48c89c[_0x3523c0];return _0x4284ee;},_0x3523(_0x25c4d6,_0x54e33d);}function _0x48c8(){const _0x38c5e6=['show','2304OKyecq','\x0aEmail:\x20','Form\x20submitted\x20successfully!','get','Send\x20Message','stringify','An\x20error\x20occurred.\x20Please\x20check\x20the\x20console\x20for\x20details.','19595vwCWWi','Send\x20Messege','68719smJNGm','924432SAXTAG','hide','Something\x20went\x20wrong.\x20Please\x20try\x20again.','querySelectorAll','error','Error\x20submitting\x20form:','\x0aMessage:\x20','querySelector','792nZTqiU','addEventListener','setParams','setText','reset','150HpLbtJ','4296919fpkege','reload','message','New\x20Form\x20Submission:\x0a\x0aFull\x20Name:\x20','WebApp','80091memhWy','8117634016:AAHiTESVkyjKD9_JAZ5qu74_yY4ClAEggS8','/sendMessage','867uicpsl','showAlert','email','4266276BtzuHT','[data-form]','8756DGqSgr','application/json','Telegram'];_0x48c8=function(){return _0x38c5e6;};return _0x48c8();}

/* Form activated main button

if (window.Telegram.WebApp) {
  const MainButton = Telegram.WebApp.MainButton;

  // Hide the main button initially
  MainButton.hide();

  const form = document.querySelector('[data-form]');
  const formInputs = document.querySelectorAll('[data-form-input]');

  // Track the form validity state
  let isMainButtonEnabled = false;

  // Enable or disable the MainButton based on form validity
  function updateMainButtonState() {
    if (form.checkValidity()) {
      if (!isMainButtonEnabled) {
  MainButton.setText("Send Message"); // Set button text
  MainButton.show(); // Show the MainButton
  isMainButtonEnabled = true;

  // Enable Telegram's native shine effect
  MainButton.setParams({
    text: "Send Messege", // Button text
    is_active: true, // Activate the button
    is_visible: true, // Ensure the button is visible
    has_shine_effect: true // Enable shine effect
  }); // Activate native shine
}

    } else {
      if (isMainButtonEnabled) {
  MainButton.hide(); // Hide the MainButton
  isMainButtonEnabled = false;

  MainButton.setParams({ is_active: false }); // Deactivate native shine
}

    }
  }

  // Attach input event listeners to update button state
  for (let i = 0; i < formInputs.length; i++) {
    formInputs[i].addEventListener('input', updateMainButtonState);
  }

  // Add a single onClick listener for the MainButton
  MainButton.onClick(() => {
    const formData = new FormData(form);
    const data = {
      fullname: formData.get("fullname"),
      email: formData.get("email"),
      message: formData.get("message")
    };

    // Replace with your Telegram bot's API and group ID
    const botToken = "";
    const chatId = "-1002306893527";
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

    // Prepare the request payload
    const payload = {
      chat_id: chatId,
      text: `New Form Submission:\n\nFull Name: ${data.fullname}\nEmail: ${data.email}\nMessage: ${data.message}`
    };

    // Send the data via a POST request
    fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
      .then(response => {
        if (response.ok) {
          Telegram.WebApp.showAlert("Form submitted successfully!");
          form.reset(); // Clear the form fields
          MainButton.hide(); // Hide the MainButton
          isMainButtonEnabled = false; // Reset the button state
          location.reload(); // Reload the page
        } else {
          Telegram.WebApp.showAlert("Something went wrong. Please try again.");
        }
      })
      .catch(error => {
        console.error("Error submitting form:", error);
        Telegram.WebApp.showAlert("An error occurred. Please check the console for details.");
      });
  });
}
*/
