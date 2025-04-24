// Set the name & header Colour
if (window.Telegram.WebApp) {
  const webApp = Telegram.WebApp;
  const userNameSpan = document.getElementById('userName');
  const user = webApp.initDataUnsafe?.user || {};
  const displayName = user.first_name
      ? `${user.first_name} ${user.last_name || ''}`
    : user.username ? `@${user.username}` : 'User';
  userNameSpan.textContent = displayName;

if (webApp.themeParams.header_bg_color) {
webApp.setHeaderColor(webApp.themeParams.header_bg_color);
  }
}


/* User Data Here
const userData = Telegram.WebApp.initDataUnsafe.user;
const userId = userData.id;
const firstName = userData.first_name || '';
const lastName = userData.last_name || '';
const username = userData.username || 'not set'; */

// Essential Components Here
const mainB = Telegram.WebApp.MainButton;
const secB = Telegram.WebApp.SecondaryButton;
let cabin = "";
let scores = {
      Zeus: 0,
      Poseidon: 0,
      Athena: 0,
      Apollo: 0,
      Aphrodite: 0,
      Demeter: 0,
      Hephaestus: 0,
      Hades: 0
    };

// Next Page Function till 172
function nextStep(currentStepId, nextStepId, answer) {

  if (currentStepId === 'step1') {
        
        if (answer === 's1a1') {
          scores.Aphrodite -= 25;
        }
      } 
      
  else if (currentStepId === 'step2') {
        
        if (answer === 's2a1') {
          scores.Zeus += 1;
        } else if (answer === 's2a2') {
          scores.Hades += 1;
        } else if (answer === 's2a3') {
          scores.Poseidon += 1;
        } else if (answer === 's2a4') {
          scores.Athena += 1;
        } else if (answer === 's2a5') {
          scores.Apollo += 1;
        } else if (answer === 's2a6') {
          scores.Aphrodite += 1;
        } else if (answer === 's2a7') {
          scores.Demeter += 1;
        } else if (answer === 's2a8') {
          scores.Hephaestus += 1;
        }
      }
      
  else if (currentStepId === 'step3') {
        
        if (answer === 's3a1') {
          scores.Zeus += 1;
        } else if (answer === 's3a2') {
          scores.Athena += 1;
        } else if (answer === 's3a3') {
          scores.Apollo += 1;
        } else if (answer === 's3a4') {
          scores.Demeter += 1;
        }
      }
      
  else if (currentStepId === 'step4') {
        
        if (answer === 's4a1') {
          scores.Zeus += 1;
        } else if (answer === 's4a2') {
          scores.Hades += 1;
        } else if (answer === 's4a3') {
          scores.Poseidon += 1;
        } else if (answer === 's4a4') {
          scores.Athena += 1;
        } else if (answer === 's4a5') {
          scores.Apollo += 1;
        } else if (answer === 's4a6') {
          scores.Aphrodite += 1;
        } else if (answer === 's4a7') {
          scores.Demeter += 1;
        } else if (answer === 's4a8') {
          scores.Hephaestus += 1;
        }
      }
      
  else if (currentStepId === 'step5') {
        // Environment mapping.
        if (answer === 's5a1') {
          scores.Zeus += 1;
        } else if (answer === 's5a2') {
          scores.Hades += 1;
        } else if (answer === 's5a3') {
          scores.Poseidon += 1;
        } else if (answer === 's5a4') {
          scores.Athena += 1;
        } else if (answer === 's5a5') {
          scores.Apollo += 1;
        } else if (answer === 's5a6') {
          scores.Aphrodite += 1;
        } else if (answer === 's5a7') {
          scores.Demeter += 1;
        } else if (answer === 's5a8') {
          scores.Hephaestus += 1;
        }
      }

document.getElementById(currentStepId).classList.remove('active');
document.getElementById(nextStepId).classList.add('active');

if (nextStepId === 'confirm') {
calculateCabin();
 mainB.show();
 secB.show();
 secB.text = 'Clear';
  }
} // Next Page Function end Here


// Calculate the final points Function
function calculateCabin() {
  let maxScore = -Infinity;
    for (let key in scores) {
      if (scores[key] > maxScore) {
         maxScore = scores[key];
         cabin = key;
        }
      }
document.getElementById('cabinName').innerText = cabin;
  
  if (cabin === 'Zeus') {
document.getElementById('cabinLink').href = 'https://t.me/zeus';
    }
  else if (cabin === 'Poseidon') {
document.getElementById('cabinLink').href = 'https://t.me/poseidon';
    }
} // Calculate function ends here



// Enabling Contact Form
const form = document.querySelector('[data-form]');
const formInputs = document.querySelectorAll('[data-form-input]');

for(let i = 0; i < formInputs.length; i++) {
  formInputs[i].addEventListener('input', function () {
   if(form.checkValidity()) {
   alert("working");
mainB.setParams({
          text: "Begin The Trial",
          is_active: true,
          is_visible: true,
          has_shine_effect: true
        });
   } 
    })
} // Contact form ends here


// Main Button Section
mainB.onClick(() => {
  
  if (mainB.text === 'Begin The Trial') {
document.getElementById('start').classList.remove('active');
document.getElementById('step1').classList.add('active');
    
    mainB.setParams({
      text: "Confirm",
      is_active: true,
      is_visible: false,
      has_shine_effect: false,
    });
  } 
  
 
  else if (mainB.text === 'Confirm') {
  
const form = document.querySelector('[data-form]');
const formData = {
   fullname: form.querySelector('[name="fullname"]').value,
   age: form.querySelector('[name="age"]').value,
   school: form.querySelector('[name="school"]').value,
   };

    // Prepare the message text
    const message = `
**New Form Submission**:

Name: ${formData.fullname} 
Cabin: ${cabin}
Age: ${formData.age}
School: ${formData.school}

Telegram Name: ${firstName} ${lastName}
Username: @${username}
User Id: ${userId}`;

// Define your Telegram Bot API details
const botToken = '8117634016:AAHiTESVkyjKD9_JAZ5qu74_yY4ClAEggS8';
const chatId = '-1002306893527';
const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    // Send the message via an HTTPS POST request
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    })
      .then((response) => {
        if (response.ok) {
          console.log('Message sent successfully');
          Telegram.WebApp.showAlert('Form submitted successfully!');
        } else {
          console.error('Failed to send message', response);
          Telegram.WebApp.showAlert('Failed to submit form. Please try again.');
        }
      })
      .catch((error) => {
        console.error('Error:', error);
        Telegram.WebApp.showAlert('Error sending form submission.');
      });

// Transition from step4 to finish
document.getElementById('step4').classList.remove('active');
document.getElementById('finish').classList.add('active');
    secB.hide();
    mainB.setParams({
      text: "Finish",
      is_active: true,
      is_visible: true,
      has_shine_effect: false,
    });
  } 
  
  
  else if (mainB.text === 'Finish') {
    Telegram.WebApp.close();
  }
});



//Secondary Click function  
secB.onClick (() => {
  if (secB.text === 'Clear') {
    Telegram.WebApp.close();
    }
});