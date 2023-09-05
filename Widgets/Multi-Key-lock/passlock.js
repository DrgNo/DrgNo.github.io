/*To add more passkeys simply duplicate the below format*/

const passwords = [
    { pass: '54' },
    { pass: '34' },
    { pass: '54' },
];

function myFunction() {
  var y = document.getElementById('demo');
  var z = document.getElementById('error');
  
  const passInput = document.getElementById('myInput').value;
  const passMatch = passwords.find(o => o.pass === passInput);
  
  if (passMatch ) {
    y.style.display = 'block';
    z.style.display = 'none';
      } 
  else {
    y.style.display = 'none';
    z.style.display = 'block';
      }
}

/*This is just a child-play type passkey protection. And because of that, anyone who has a tiny knowledge about inspection mode can find it very easily. If you want a real passlock, Please do it with a server-side. not with client-side.
