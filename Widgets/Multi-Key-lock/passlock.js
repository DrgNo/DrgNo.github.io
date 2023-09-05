/*To add more passkeys simply duplicate the below format*/

const passwords = [
    { pass: 'password01' },
    { pass: 'password02' },
    { pass: 'password03' },
    { pass: 'MasterKey'}, /*create a masterkey just for yourself*/
];

function myFunction() {
  var y = document.getElementById('protected');
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
