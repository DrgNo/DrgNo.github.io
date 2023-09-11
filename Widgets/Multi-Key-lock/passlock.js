/*To add more passkeys simply duplicate the below format*/

const passwords = [
    { id: 'admin' , pass: 'admin' },
];

function myFunction() {
  var y = document.getElementById('protected');
  var z = document.getElementById('error');
  var b = document.getElementById('boxs');
  var t = document.getElementById('tgscode');
  var e = document.getElementById('tgserror');

  const passId = document.getElementById('myId').value;
  const passPw = document.getElementById('myPw').value;
  const passMatch = passwords.find(o => o.id === passId && o.pass === passPw );
  
  if (passMatch ) {
    y.classList.add('fadein');
    y.classList.remove('hide');
    z.style.display = 'none';
    b.className = 'fadeout';
      } 
  else {
    z.style.display = 'block';
    t.style.display = 'none';
    e.style.display = 'block';
      }
}
