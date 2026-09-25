export default function App() {
  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#1e1e24', color: 'white', fontFamily: 'sans-serif' }}>
      
      {/* Sidebar - Servers and Channels */}
      <div style={{ width: '250px', backgroundColor: '#121216', padding: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#00ffcc' }}>Shinzi Hub</h1>
        
        <div style={{ marginTop: '30px' }}>
          <h3 style={{ fontSize: '12px', color: '#888', textTransform: 'uppercase' }}>Text Channels</h3>
          <ul style={{ marginTop: '10px', listStyle: 'none', padding: 0 }}>
            <li style={{ padding: '8px 0', color: '#ccc', cursor: 'pointer' }}># general</li>
            <li style={{ padding: '8px 0', color: '#ccc', cursor: 'pointer' }}># server-dev</li>
          </ul>
        </div>
      </div>

      {/* Main Chat Area */}
      <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column' }}>
        
        {/* Chat History */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <p style={{ color: '#888' }}>Welcome to the beginning of Shinzi Hub.</p>
        </div>
        
        {/* Message Input Box */}
        <input
          type="text"
          placeholder="Message #general..."
          style={{ padding: '15px', borderRadius: '8px', border: 'none', backgroundColor: '#2a2a35', color: 'white', outline: 'none' }}
        />
        
      </div>
    </div>
  );
}
