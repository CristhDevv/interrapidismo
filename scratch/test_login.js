const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://cnmxpvryfksixytbnvnq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubXhwdnJ5ZmtzaXh5dGJudm5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczODQ0MTIsImV4cCI6MjA5Mjk2MDQxMn0.seOjEZucLUlOA2pOFfPtbozJMh_r-0hU-qffeWnN0X4'
);

async function testLogin() {
  console.log('Testing mensajero login...');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'mensajero@interrapidisimo.com',
    password: 'Soloc@li1',
  });

  if (error) {
    console.error('Login failed:', error.message);
  } else {
    console.log('Login successful! User ID:', data.user.id);
  }
}

testLogin();
