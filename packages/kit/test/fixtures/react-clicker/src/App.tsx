import { useState } from "react";

export function App() {
  const [clicks, setClicks] = useState(0);
  function click() {
    const next = clicks + 1;
    setClicks(next);
    if (next % 100 === 0) {
      // milestone reached
    }
  }
  return <button onClick={click}>{clicks}</button>;
}
