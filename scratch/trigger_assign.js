async function testAssign() {
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Soloc@li1' })
  });
  const { token } = await loginRes.json();
  console.log('Token acquired');

  const assignRes1 = await fetch('http://localhost:3000/api/guides/assign', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      domiciliario_id: 1,
      base_amount: 5000,
      guides: [
        { guide_number: 'STABLE_GUIDE_1', value: 2000, type: 'entrega' }
      ]
    })
  });
  
  const result1 = await assignRes1.json();
  console.log('First assign (create):', JSON.stringify(result1, null, 2));

  const assignRes2 = await fetch('http://localhost:3000/api/guides/assign', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      domiciliario_id: 1,
      base_amount: 7000,
      guides: [
        { guide_number: 'STABLE_GUIDE_1', value: 3000, type: 'envio' }
      ]
    })
  });
  
  const result2 = await assignRes2.json();
  console.log('Second assign (update):', JSON.stringify(result2, null, 2));
}

testAssign().catch(console.error);
