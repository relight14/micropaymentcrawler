import { useState, useEffect } from "react";
import { Header } from "./components/Header";
import { ChatInterface } from "./components/ChatInterface";

export default function App() {
  const [mode, setMode] = useState<'chat' | 'research'>('chat');
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    // Check for system preference or saved preference
    const savedMode = localStorage.getItem('darkMode');
    const systemPreference = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    const shouldUseDark = savedMode ? JSON.parse(savedMode) : systemPreference;
    setDarkMode(shouldUseDark);
    
    if (shouldUseDark) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  const handleDarkModeToggle = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem('darkMode', JSON.stringify(newMode));
    
    if (newMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  return (
    <div className="min-h-screen bg-[#F1F1F1] dark:bg-[#464646]">
      <Header 
        mode={mode}
        onModeChange={setMode}
        darkMode={darkMode}
        onDarkModeToggle={handleDarkModeToggle}
      />
      
      <main className="h-[calc(100vh-80px)]">
        <ChatInterface mode={mode} />
      </main>
    </div>
  );
}