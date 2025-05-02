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


//User Data Here
const userData = Telegram.WebApp.initDataUnsafe.user;
const userId = userData.id;
const firstName = userData.first_name || '';
const lastName = userData.last_name || '';
const username = userData.username || 'not set';

// Essential Components Here
const mainB = Telegram.WebApp.MainButton;
const secB = Telegram.WebApp.SecondaryButton;
let cabin = "";
let gender = "";
let scores = {
      Athena: 0,
      Poseidon: 0,
      Zeus: 0,
      Ares: 0,
      Apollo: 0,
      Hades: 0,
      Hephasutus: 0,
      Aphrodite: 0,
      Hermes: 0,
      Dionysus: 0,
    };

// Next Page Function till 172
function nextStep(currentStepId, nextStepId, answer) {

if (currentStepId === 'step1') {
       if (answer === 's1a1') {
          scores.Aphrodite -= 25;
          gender = 'Male';
        }
        else if (answer === 's1a2') {
          gender = 'Female';
        }
      }
  
else if (currentStepId === 'step2') {
        if (answer === 's2a1') {
          scores.Athena += 1;
        } else if (answer === 's2a2') {
          scores.Poseidon += 1;
        } else if (answer === 's2a3') {
          scores.Zeus += 1;
        } else if (answer === 's2a4') {
          scores.Ares += 1;
        } else if (answer === 's2a5') {
          scores.Apollo += 1;
        } else if (answer === 's2a6') {
          scores.Hades += 1;
        } else if (answer === 's2a7') {
          scores.Hephasutus += 1;
        } else if (answer === 's2a8') {
          scores.Aphrodite += 1;
        } else if (answer === 's2a9') {
          scores.Hermes += 1;
        } else if (answer === 's2a10') {
          scores.Dionysus += 1;
        }
      }
      
else if (currentStepId === 'step4') {
    if (answer === 's4a1') {
        scores.Athena += 1;
    } else if (answer === 's4a2') {
        scores.Poseidon += 1;
    } else if (answer === 's4a3') {
        scores.Zeus += 1;
    } else if (answer === 's4a4') {
        scores.Ares += 1;
    } else if (answer === 's4a5') {
        scores.Apollo += 1;
    } else if (answer === 's4a6') {
        scores.Hades += 1;
    } else if (answer === 's4a7') {
        scores.Hephaestus += 1;
    } else if (answer === 's4a8') {
        scores.Aphrodite += 1;
    } else if (answer === 's4a9') {
        scores.Hermes += 1;
    } else if (answer === 's4a10') {
        scores.Dionysus += 1;
    }
} 

else if (currentStepId === 'step5') {
    if (answer === 's5a1') {
        scores.Athena += 1;
    } else if (answer === 's5a2') {
        scores.Poseidon += 1;
    } else if (answer === 's5a3') {
        scores.Zeus += 1;
    } else if (answer === 's5a4') {
        scores.Ares += 1;
    } else if (answer === 's5a5') {
        scores.Apollo += 1;
    } else if (answer === 's5a6') {
        scores.Hades += 1;
    } else if (answer === 's5a7') {
        scores.Hephaestus += 1;
    } else if (answer === 's5a8') {
        scores.Aphrodite += 1;
    } else if (answer === 's5a9') {
        scores.Hermes += 1;
    } else if (answer === 's5a10') {
        scores.Dionysus += 1;
    }
} 

else if (currentStepId === 'step6') {
    if (answer === 's6a1') {
        scores.Athena += 1;
    } else if (answer === 's6a2') {
        scores.Poseidon += 1;
    } else if (answer === 's6a3') {
        scores.Zeus += 1;
    } else if (answer === 's6a4') {
        scores.Ares += 1;
    } else if (answer === 's6a5') {
        scores.Apollo += 1;
    } else if (answer === 's6a6') {
        scores.Hades += 1;
    } else if (answer === 's6a7') {
        scores.Hephaestus += 1;
    } else if (answer === 's6a8') {
        scores.Aphrodite += 1;
    } else if (answer === 's6a9') {
        scores.Hermes += 1;
    } else if (answer === 's6a10') {
        scores.Dionysus += 1;
    }
} 

else if (currentStepId === 'step7') {
    if (answer === 's7a1') {
        scores.Athena += 1;
    } else if (answer === 's7a2') {
        scores.Poseidon += 1;
    } else if (answer === 's7a3') {
        scores.Zeus += 1;
    } else if (answer === 's7a4') {
        scores.Ares += 1;
    } else if (answer === 's7a5') {
        scores.Apollo += 1;
    } else if (answer === 's7a6') {
        scores.Hades += 1;
    } else if (answer === 's7a7') {
        scores.Hephaestus += 1;
    } else if (answer === 's7a8') {
        scores.Aphrodite += 1;
    } else if (answer === 's7a9') {
        scores.Hermes += 1;
    } else if (answer === 's7a10') {
        scores.Dionysus += 1;
    }
} 

else if (currentStepId === 'step8') {
    if (answer === 's8a1') {
        scores.Athena += 1;
    } else if (answer === 's8a2') {
        scores.Poseidon += 1;
    } else if (answer === 's8a3') {
        scores.Zeus += 1;
    } else if (answer === 's8a4') {
        scores.Ares += 1;
    } else if (answer === 's8a5') {
        scores.Apollo += 1;
    } else if (answer === 's8a6') {
        scores.Hades += 1;
    } else if (answer === 's8a7') {
        scores.Hephaestus += 1;
    } else if (answer === 's8a8') {
        scores.Aphrodite += 1;
    } else if (answer === 's8a9') {
        scores.Hermes += 1;
    } else if (answer === 's8a10') {
        scores.Dionysus += 1;
    }
} 

else if (currentStepId === 'step9') {
    if (answer === 's9a1') {
        scores.Athena += 1;
    } else if (answer === 's9a2') {
        scores.Poseidon += 1;
    } else if (answer === 's9a3') {
        scores.Zeus += 1;
    } else if (answer === 's9a4') {
        scores.Ares += 1;
    } else if (answer === 's9a5') {
        scores.Apollo += 1;
    } else if (answer === 's9a6') {
        scores.Hades += 1;
    } else if (answer === 's9a7') {
        scores.Hephaestus += 1;
    } else if (answer === 's9a8') {
        scores.Aphrodite += 1;
    } else if (answer === 's9a9') {
        scores.Hermes += 1;
    } else if (answer === 's9a10') {
        scores.Dionysus += 1;
    }
} 

else if (currentStepId === 'step10') {
    if (answer === 's10a1') {
        scores.Athena += 1;
    } else if (answer === 's10a2') {
        scores.Poseidon += 1;
    } else if (answer === 's10a3') {
        scores.Zeus += 1;
    } else if (answer === 's10a4') {
        scores.Ares += 1;
    } else if (answer === 's10a5') {
        scores.Apollo += 1;
    } else if (answer === 's10a6') {
        scores.Hades += 1;
    } else if (answer === 's10a7') {
        scores.Hephaestus += 1;
    } else if (answer === 's10a8') {
        scores.Aphrodite += 1;
    } else if (answer === 's10a9') {
        scores.Hermes += 1;
    } else if (answer === 's10a10') {
        scores.Dionysus += 1;
    }
} 

else if (currentStepId === 'step11') {
    if (answer === 's11a1') {
        scores.Athena += 1;
    } else if (answer === 's11a2') {
        scores.Poseidon += 1;
    } else if (answer === 's11a3') {
        scores.Zeus += 1;
    } else if (answer === 's11a4') {
        scores.Ares += 1;
    } else if (answer === 's11a5') {
        scores.Apollo += 1;
    } else if (answer === 's11a6') {
        scores.Hades += 1;
    } else if (answer === 's11a7') {
        scores.Hephaestus += 1;
    } else if (answer === 's11a8') {
        scores.Aphrodite += 1;
    } else if (answer === 's11a9') {
        scores.Hermes += 1;
    } else if (answer === 's11a10') {
        scores.Dionysus += 1;
    }
} 

else if (currentStepId === 'step12') {
    if (answer === 's12a1') {
        scores.Athena += 1;
    } else if (answer === 's12a2') {
        scores.Poseidon += 1;
    } else if (answer === 's12a3') {
        scores.Zeus += 1;
    } else if (answer === 's12a4') {
        scores.Ares += 1;
    } else if (answer === 's12a5') {
        scores.Apollo += 1;
    } else if (answer === 's12a6') {
        scores.Hades += 1;
    } else if (answer === 's12a7') {
        scores.Hephaestus += 1;
    } else if (answer === 's12a8') {
        scores.Aphrodite += 1;
    } else if (answer === 's12a9') {
        scores.Hermes += 1;
    } else if (answer === 's12a10') {
        scores.Dionysus += 1;
    }
} 

setTimeout(() => {
document.getElementById(currentStepId).classList.remove('active');
document.getElementById(nextStepId).classList.add('active');
}, 300);

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
  
if (cabin === 'Athena') {
document.getElementById('cabinLink').href = 'https://t.me/+-1HdZxa9EfM5OWJl';
    }
else if (cabin === 'Poseidon') {
document.getElementById('cabinLink').href = 'https://t.me/+fPkAs0xAdQs0OWU9';
    }
else if (cabin === 'Zeus') {
document.getElementById('cabinLink').href = 'https://t.me/+CzPcnuu-2mswODll';
    }
else if (cabin === 'Ares') {
document.getElementById('cabinLink').href = 'https://t.me/+Exxbx5X69bgyZDhl';
    }
else if (cabin === 'Apollo') {
document.getElementById('cabinLink').href = 'https://t.me/+p_tmStslQJQ1MTRl';
    }
else if (cabin === 'Hades') {
document.getElementById('cabinLink').href = 'https://t.me/+upeSZWTEPAYxOTA1';
    }
else if (cabin === 'Hephasutus') {
document.getElementById('cabinLink').href = 'https://t.me/+YK8_ZQ7-ODc0NDBl';
    }
else if (cabin === 'Aphrodite') {
document.getElementById('cabinLink').href = 'https://t.me/+_nFC1cs15rgyNzRl';
    }
else if (cabin === 'Hermes') {
document.getElementById('cabinLink').href = 'https://t.me/+hCUwZN2R3NQ3YjY1';
    }
else if (cabin === 'Dionysus') {
document.getElementById('cabinLink').href = 'https://t.me/+xybZT7TslEE5YmY1';
    }
} // Calculate function ends here





// Enabling Contact Form
const form = document.querySelector('[data-form]');
const formInputs = document.querySelectorAll('[data-form-input]');

for(let i = 0; i < formInputs.length; i++) {
  formInputs[i].addEventListener('input', function () {
   if(form.checkValidity()) {      
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
Assigning member to Cabin: ${cabin}

Name: ${formData.fullname}
Age: ${formData.age}
School: ${formData.school}
Gender: ${gender}

Telegram Name: ${firstName} ${lastName}
Username: @${username}
User Id: ${userId}`;

// Define your Telegram Bot API details
const botToken = '7893267309:AAFV3OEpw1YfF0j4qYbvlMtSo1hFomD08pM';
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
        } else {
          console.error('Failed to send message', response);
          Telegram.WebApp.showAlert('Failed to submit form. Please try again.');
        }
      })
      .catch((error) => {
        console.error('Error:', error);
        Telegram.WebApp.showAlert('Error sending your details.');
      });

// Transition from step4 to finish
setTimeout(() => {
document.getElementById('confirm').classList.remove('active');
document.getElementById('finish').classList.add('active');
}, 300);
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
