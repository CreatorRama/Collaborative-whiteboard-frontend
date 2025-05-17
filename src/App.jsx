import { useState, useEffect, useRef } from 'react';
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
  const stageRef = useRef(null);
  const nameInputRef = useRef(null);
  const [senderName, setSenderName] = useState("");
  const wsRef = useRef(null);
  const chatContainerRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  const connectWebSocket = () => {
    // Clear any existing reconnection timeouts
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    setConnectionStatus("Connecting...");
    
    // Create new WebSocket connection
    const socket = new WebSocket('wss://collaborative-whiteboard-backend-n4qk.onrender.com');
    wsRef.current = socket;

    socket.onopen = () => {
      console.log('Connected to WebSocket server');
      setConnectionStatus("Connected");
    };

    socket.onmessage = (event) => {
      console.log('Raw message received:', event.data);
      try {
        const message = JSON.parse(event.data);
        console.log('Parsed message from server:', message);

        if (message.type === 'INIT') {
          setLines(message.data);
        } else if (message.type === 'DRAW') {
          setLines(prev => [...prev, message.data]);
        } else if (message.type === 'CHAT') {
          console.log('Chat message details:', message);
          if (message.Name && message.res) {
            setMessages(prev => [...prev, { 
              Name: message.Name, 
              res: message.res 
            }]);
          } else {
            console.warn('Received malformed CHAT message:', message);
          }
        }
      } catch (error) {
        console.error('Error parsing message:', error, event.data);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionStatus("Error - Reconnecting...");
    };

    socket.onclose = () => {
      console.log('WebSocket connection closed');
      setConnectionStatus("Disconnected - Reconnecting...");
      
      // Set up reconnection attempt
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 3000); // Try to reconnect after 3 seconds
    };
  };

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

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
    }
  };

  const handleChatSubmit = () => {
    if (!senderName || !text.trim()) return;
    
    // Send message to server
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: "CHAT", res: text.trim(), Name: senderName })
      );
    } else {
      // Handle case when websocket is not connected
      alert("Cannot send message - not connected to server. Please wait for reconnection.");
    }

    setText("");
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
          <button onClick={() => setTool('pen')} style={{ marginRight: '5px' }}>Pen</button>
          <button onClick={() => setTool('eraser')} style={{ marginRight: '5px' }}>Eraser</button>
          <button onClick={undo} disabled={undoStack.length === 0} style={{ marginRight: '5px' }}>Undo</button>
          <button onClick={redo} disabled={redoStack.length === 0} style={{ marginRight: '5px' }}>Redo</button>
          <button onClick={clearCanvas} style={{ marginRight: '5px' }}>Clear</button>
          <span style={{ 
            marginLeft: '15px', 
            fontWeight: 'bold',
            color: connectionStatus === "Connected" ? "green" : 
                   connectionStatus.includes("Error") ? "red" : "orange"
          }}>
            Status: {connectionStatus}
          </span>
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
              <div style={{ fontWeight: "bold", color: message.Name === senderName ? "#007bff" : "#212529" }}>
                {message.Name}:
              </div>
              <div style={{ 
                backgroundColor: message.Name === senderName ? "#e3f2fd" : "#f8f9fa",
                padding: "5px 10px",
                borderRadius: "4px",
                wordBreak: "break-word"
              }}>
                {message.res}
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
              disabled={!text.trim() || wsRef.current?.readyState !== WebSocket.OPEN}
              style={{ 
                backgroundColor: "#007bff", 
                color: "white", 
                border: "none", 
                padding: "8px 12px",
                borderRadius: "4px",
                cursor: text.trim() && wsRef.current?.readyState === WebSocket.OPEN ? "pointer" : "not-allowed",
                opacity: text.trim() && wsRef.current?.readyState === WebSocket.OPEN ? 1 : 0.7
              }}
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;