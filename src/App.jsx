import { useState, useEffect, useRef, useCallback } from 'react';
import { Stage, Layer, Line } from 'react-konva';
import { v4 as uuidv4 } from 'uuid';

function App() {
  const [lines, setLines] = useState([]);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("Connecting...");
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [reconnectStrategy, setReconnectStrategy] = useState(0); // 0=auto, 1=wss, 2=ws, 3=direct
  const stageRef = useRef(null);
  const nameInputRef = useRef(null);
  const [senderName, setSenderName] = useState("");
  const wsRef = useRef(null);
  const chatContainerRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const pendingMessagesRef = useRef([]);
  const lastPongRef = useRef(Date.now());
  
  // Get WebSocket URL based on current strategy
  const getWebSocketUrl = useCallback(() => {
    let wsUrl;
    
    // If user has selected a specific strategy
    if (reconnectStrategy !== 0) {
      switch (reconnectStrategy) {
        case 1: // WSS
          return 'wss://collaborative-whiteboard-backend-n4qk.onrender.com';
        case 2: // WS
          return 'ws://collaborative-whiteboard-backend-n4qk.onrender.com';
        case 3: // Direct port
          return 'wss://collaborative-whiteboard-backend-n4qk.onrender.com:8080';
        default:
          break;
      }
    }
    
    // Auto strategy (rotate through options)
    const rotationIndex = connectionAttempts % 5;
    
    // Try different URLs with exponential backoff built into the rotation
    switch (rotationIndex) {
      case 0:
        wsUrl = 'wss://collaborative-whiteboard-backend-n4qk.onrender.com';
        break;
      case 1: 
        wsUrl = 'ws://collaborative-whiteboard-backend-n4qk.onrender.com';
        break;
      case 2:
        wsUrl = 'wss://collaborative-whiteboard-backend-n4qk.onrender.com:8080';
        break;
      case 3:
        // Try without path
        wsUrl = window.location.protocol === 'https:' 
          ? 'wss://collaborative-whiteboard-backend-n4qk.onrender.com' 
          : 'ws://collaborative-whiteboard-backend-n4qk.onrender.com';
        break;
      case 4:
        // Try localhost for local development
        wsUrl = 'ws://localhost:8080';
        break;
      default:
        wsUrl = 'wss://collaborative-whiteboard-backend-n4qk.onrender.com';
    }
    
    return wsUrl;
  }, [reconnectStrategy, connectionAttempts]);

  const connectWebSocket = useCallback(() => {
    // Clear any existing reconnection timeouts
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Clear any existing ping intervals
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    // Update connection status
    setConnectionStatus(`Connecting... (Attempt ${connectionAttempts + 1})`);
    setConnectionAttempts(prev => prev + 1);
    
    // Get WebSocket URL based on strategy
    const wsUrl = getWebSocketUrl();
    console.log(`Attempting connection to: ${wsUrl}`);
    
    try {
      // Create new WebSocket connection
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        console.log('Connected to WebSocket server');
        setConnectionStatus("Connected");
        lastPongRef.current = Date.now(); // Reset pong timer
        
        // Send any pending messages
        if (pendingMessagesRef.current.length > 0) {
          console.log(`Sending ${pendingMessagesRef.current.length} pending messages`);
          
          pendingMessagesRef.current.forEach(msg => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify(msg));
            }
          });
          
          // Clear pending messages
          pendingMessagesRef.current = [];
          
          // Update UI to remove "pending" status
          setMessages(prev => prev.map(msg => ({...msg, pending: false})));
        }
        
        // Add a ping to keep the connection alive
        pingIntervalRef.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            // Send a ping message
            socket.send(JSON.stringify({ type: 'PING' }));
            
            // Check if we've received a response since last ping
            const timeSinceLastPong = Date.now() - lastPongRef.current;
            if (timeSinceLastPong > 60000) { // 60 seconds
              console.warn(`No pong received for ${Math.round(timeSinceLastPong/1000)}s, reconnecting...`);
              socket.close();
              connectWebSocket();
            }
          }
        }, 30000); // Send ping every 30 seconds
        
        // Add a system message
        setMessages(prev => [...prev, { 
          Name: "System", 
          res: "Connected to the whiteboard server" 
        }]);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('Received message type:', message.type);

          if (message.type === 'INIT') {
            setLines(message.data);
          } 
          else if (message.type === 'DRAW') {
            setLines(prev => [...prev, message.data]);
          } 
          else if (message.type === 'CHAT') {
            if (message.Name && message.res) {
              setMessages(prev => [...prev, { 
                Name: message.Name, 
                res: message.res 
              }]);
            } else {
              console.warn('Received malformed CHAT message:', message);
            }
          } 
          else if (message.type === 'SYSTEM') {
            setMessages(prev => [...prev, { 
              Name: "System", 
              res: message.message 
            }]);
          }
          else if (message.type === 'PONG') {
            lastPongRef.current = Date.now();
          }
        } catch (error) {
          console.error('Error parsing message:', error, event.data);
        }
      };

      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus(`Error - Will retry in 3s (Attempt ${connectionAttempts + 1})`);
      };

      socket.onclose = (event) => {
        console.log('WebSocket connection closed', event);
        
        // Log more debugging information
        console.log('Close event code:', event.code);
        console.log('Close event reason:', event.reason || 'No reason provided');
        console.log('Clean close:', event.wasClean);
        
        setConnectionStatus(`Disconnected - Retrying in 3s (Attempt ${connectionAttempts + 1})`);
        
        // Add a system message about disconnection
        setMessages(prev => [...prev, { 
          Name: "System", 
          res: `Connection lost. Reconnecting in 3 seconds...` 
        }]);
        
        // Clear the ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        
        // Set up reconnection attempt with increasing backoff
        const baseDelay = 3000;
        const maxDelay = 30000;
        const factor = 1.5;
        const jitter = Math.random() * 1000;
        const attempt = Math.min(connectionAttempts, 10); // Cap at 10 for backoff calculation
        
        const delay = Math.min(baseDelay * Math.pow(factor, attempt) + jitter, maxDelay);
        
        console.log(`Reconnecting in ${Math.round(delay/1000)} seconds...`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, delay);
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      
      setConnectionStatus(`Connection failed - Retrying in 5s`);

      // Try again after 5 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 5000);
    }
  }, [connectionAttempts, getWebSocketUrl]);

  useEffect(() => {
    // Init connection
    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, [connectWebSocket]);

  // Scroll to bottom of chat when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleMouseDown = (e) => {
    setIsDrawing(true);
    const pos = e.target.getStage().getPointerPosition();

    const newLine = {
      tool,
      points: [pos.x, pos.y],
      color,
      brushSize,
      id: uuidv4()
    };

    setLines([...lines, newLine]);
  };

  const handleMouseMove = (e) => {
    if (!isDrawing) return;

    const stage = e.target.getStage();
    const point = stage.getPointerPosition();

    setLines(prev => {
      const lastLine = prev[prev.length - 1];

      // Add new point
      const newLine = {
        ...lastLine,
        points: [...lastLine.points, point.x, point.y]
      };

      // Send drawing data to server
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'DRAW',
          data: newLine
        }));
      }

      return [...prev.slice(0, -1), newLine];
    });
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    // Save state for undo
    setUndoStack(prev => [...prev, lines]);
    setRedoStack([]); // Clear redo stack when new action is performed
  };

  const handleNameSubmit = () => {
    const name = nameInputRef.current.value.trim();
    if (name) {
      setSenderName(name);
      
      // Add a system message about the user joining
      setMessages(prev => [...prev, { 
        Name: "System", 
        res: `${name} has joined the whiteboard session` 
      }]);
      
      // Send system message if connected
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && name) {
        wsRef.current.send(
          JSON.stringify({ 
            type: "SYSTEM", 
            message: `${name} has joined the whiteboard session`
          })
        );
      }
    }
  };

  const handleChatSubmit = () => {
    if (!senderName || !text.trim()) return;
    
    const chatMessage = { 
      type: "CHAT", 
      res: text.trim(), 
      Name: senderName 
    };
    
    // Send message to server
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(chatMessage));
    } else {
      // Store the message locally until reconnection
      pendingMessagesRef.current.push(chatMessage);
      
      // Add to UI with pending status
      setMessages(prev => [...prev, { 
        Name: senderName, 
        res: text.trim(),
        pending: true
      }]);
      
      // Notify user
      setMessages(prev => [...prev, { 
        Name: "System", 
        res: "Message queued - will be sent when connection is restored"
      }]);
    }

    setText("");
  };

  const forceReconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    connectWebSocket();
  };

  const undo = () => {
    if (undoStack.length > 0) {
      const newUndoStack = [...undoStack];
      const previousState = newUndoStack.pop();

      setRedoStack(prev => [...prev, lines]);
      setLines(previousState);
      setUndoStack(newUndoStack);
    }
  };

  const redo = () => {
    if (redoStack.length > 0) {
      const newRedoStack = [...redoStack];
      const nextState = newRedoStack.pop();

      setUndoStack(prev => [...prev, lines]);
      setLines(nextState);
      setRedoStack(newRedoStack);
    }
  };

  const clearCanvas = () => {
    setUndoStack(prev => [...prev, lines]);
    setLines([]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', position: "relative" }}>
      <div style={{ padding: '10px', background: '#f0f0f0' }}>
        <div style={{ marginBottom: '10px' }}>
          <button onClick={() => setTool('pen')} style={{ 
            marginRight: '5px',
            backgroundColor: tool === 'pen' ? '#007bff' : '#e9ecef',
            color: tool === 'pen' ? 'white' : 'black',
            border: 'none',
            padding: '8px 12px',
            borderRadius: '4px'
          }}>Pen</button>
          <button onClick={() => setTool('eraser')} style={{ 
            marginRight: '5px',
            backgroundColor: tool === 'eraser' ? '#007bff' : '#e9ecef',
            color: tool === 'eraser' ? 'white' : 'black',
            border: 'none',
            padding: '8px 12px',
            borderRadius: '4px'
          }}>Eraser</button>
          <button onClick={undo} disabled={undoStack.length === 0} style={{ 
            marginRight: '5px',
            opacity: undoStack.length === 0 ? 0.5 : 1,
            backgroundColor: '#e9ecef',
            border: 'none',
            padding: '8px 12px',
            borderRadius: '4px'
          }}>Undo</button>
          <button onClick={redo} disabled={redoStack.length === 0} style={{ 
            marginRight: '5px',
            opacity: redoStack.length === 0 ? 0.5 : 1,
            backgroundColor: '#e9ecef',
            border: 'none',
            padding: '8px 12px',
            borderRadius: '4px'
          }}>Redo</button>
          <button onClick={clearCanvas} style={{ 
            marginRight: '5px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            padding: '8px 12px',
            borderRadius: '4px'
          }}>Clear</button>
          <span style={{ 
            marginLeft: '15px', 
            fontWeight: 'bold',
            color: connectionStatus === "Connected" ? "green" : 
                   connectionStatus.includes("Error") ? "red" : "orange"
          }}>
            Status: {connectionStatus}
          </span>
          <button 
            onClick={forceReconnect} 
            style={{ 
              marginLeft: '10px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              padding: '8px 12px',
              borderRadius: '4px'
            }}
            title="Try to reconnect manually"
          >
            Reconnect
          </button>
          
          {/* Connection strategy picker */}
          <select 
            value={reconnectStrategy}
            onChange={(e) => setReconnectStrategy(Number(e.target.value))}
            style={{
              marginLeft: '10px',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #ced4da'
            }}
          >
            <option value={0}>Auto (Default)</option>
            <option value={1}>WSS</option>
            <option value={2}>WS</option>
            <option value={3}>Direct Port</option>
          </select>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ marginRight: '10px' }}>
            Color:
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ marginLeft: '5px' }}
            />
          </label>
          <label>
            Brush Size:
            <input
              type="range"
              min="1"
              max="50"
              value={brushSize}
              onChange={(e) => setBrushSize(parseInt(e.target.value))}
              style={{ marginLeft: '5px' }}
            />
            {brushSize}px
          </label>
        </div>
      </div>

      <Stage
        width={window.innerWidth}
        height={window.innerHeight - 100}
        onMouseDown={handleMouseDown}
        onMousemove={handleMouseMove}
        onMouseup={handleMouseUp}
        ref={stageRef}
        style={{ background: 'white' }}
      >
        <Layer>
          {lines.map((line, i) => (
            <Line
              key={i}
              points={line.points}
              stroke={line.tool === 'eraser' ? 'white' : line.color}
              strokeWidth={line.brushSize}
              tension={0.5}
              lineCap="round"
              lineJoin="round"
              globalCompositeOperation={
                line.tool === 'eraser' ? 'destination-out' : 'source-over'
              }
            />
          ))}
        </Layer>
      </Stage>
      
      <div style={{ 
        position: "absolute", 
        bottom: "0", 
        right: "0", 
        height: "50%", 
        backgroundColor: "#f8f9fa", 
        boxSizing: "border-box", 
        border: "2px solid #007bff", 
        width: "30%",
        display: "flex",
        flexDirection: "column",
        padding: "10px"
      }}>
        <h3 style={{ margin: "0 0 10px 0", color: "#343a40" }}>Chat</h3>
        
        {!senderName ? (
          <div style={{ marginBottom: "15px" }}>
            <input
              type="text"
              ref={nameInputRef}
              placeholder="Enter your name"
              style={{ 
                padding: "8px", 
                marginRight: "5px", 
                borderRadius: "4px",
                border: "1px solid #ced4da"
              }}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleNameSubmit();
                }
              }}
            />
            <button 
              onClick={handleNameSubmit}
              style={{ 
                backgroundColor: "#007bff", 
                color: "white", 
                border: "none", 
                padding: "8px 12px",
                borderRadius: "4px",
                cursor: "pointer"
              }}
            >
              Set Name
            </button>
          </div>
        ) : (
          <div style={{ marginBottom: "10px" }}>
            <span style={{ fontWeight: "bold" }}>Logged in as: {senderName}</span>
            <button
              onClick={() => setSenderName("")}
              style={{
                marginLeft: "10px",
                backgroundColor: "#6c757d",
                color: "white",
                border: "none",
                padding: "4px 8px",
                borderRadius: "4px",
                fontSize: "12px",
                cursor: "pointer"
              }}
            >
              Change
            </button>
          </div>
        )}
        
        <div 
          ref={chatContainerRef}
          style={{ 
            flex: "1", 
            overflowY: "auto", 
            border: "1px solid #ced4da", 
            borderRadius: "4px",
            padding: "10px",
            marginBottom: "10px",
            backgroundColor: "white"
          }}
        >
          {messages.map((message, i) => (
            <div key={i} style={{ marginBottom: "8px" }}>
              <div style={{ 
                fontWeight: "bold", 
                color: message.Name === "System" ? "#6c757d" : 
                       message.Name === senderName ? "#007bff" : "#212529" 
              }}>
                {message.Name}:
              </div>
              <div style={{ 
                backgroundColor: message.Name === "System" ? "#f1f1f1" :
                                 message.Name === senderName ? "#e3f2fd" : "#f8f9fa",
                padding: "5px 10px",
                borderRadius: "4px",
                wordBreak: "break-word",
                borderLeft: message.pending ? "3px solid #ffc107" : "none"
              }}>
                {message.res}
                {message.pending && <span style={{color: "#ffc107", marginLeft: "5px"}}> (pending)</span>}
              </div>
            </div>
          ))}
        </div>
        
        {senderName && (
          <div style={{ display: "flex" }}>
            <textarea
              placeholder="Type your message..."
              style={{ 
                flex: "1", 
                marginRight: "5px", 
                padding: "8px",
                borderRadius: "4px",
                border: "1px solid #ced4da",
                resize: "none",
                height: "60px"
              }}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleChatSubmit();
                }
              }}
            />
            <button
              onClick={handleChatSubmit}
              disabled={!text.trim()}
              style={{ 
                backgroundColor: "#007bff", 
                color: "white", 
                border: "none", 
                padding: "8px 12px",
                borderRadius: "4px",
                cursor: text.trim() ? "pointer" : "not-allowed",
                opacity: text.trim() ? 1 : 0.7
              }}
            >
              Send
            </button>
          </div>
        )}
      </div>
      
      {/* Connection Debug Info */}
      <div style={{
        position: "absolute",
        bottom: "10px",
        left: "10px",
        backgroundColor: "rgba(0,0,0,0.7)",
        color: "white",
        padding: "10px",
        borderRadius: "5px",
        fontSize: "12px",
        maxWidth: "300px"
      }}>
        <div><strong>Connection Status:</strong> {connectionStatus}</div>
        <div><strong>Attempts:</strong> {connectionAttempts}</div>
        <div><strong>Strategy:</strong> {
          reconnectStrategy === 0 ? "Auto" :
          reconnectStrategy === 1 ? "WSS" :
          reconnectStrategy === 2 ? "WS" : "Direct Port"
        }</div>
        <div><strong>Current URL:</strong> {getWebSocketUrl()}</div>
        <div><strong>Last Pong:</strong> {
          Math.round((Date.now() - lastPongRef.current) / 1000)
        }s ago</div>
        <div><strong>Pending Messages:</strong> {pendingMessagesRef.current.length}</div>
      </div>
    </div>
  );
}

export default App;
