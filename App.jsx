import React, { useState, useEffect } from 'react';

export default function App() {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    fetch('http://localhost:8000/orders')
      .then((res) => res.json())
      .then((data) => setOrders(data));
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Open Orders</h1>
      <ul>
        {orders.map((item, index) => (
          <li key={index} style={{ marginBottom: '8px' }}>
            <strong>Order #{item.orderNumber}</strong> (Seq: {item.SeqNum}) — 
            Product: {item.ProductCode ?? 'N/A'} | 
            Qty: {item.QtyOrdered ?? 0} | 
            Avail: {item.QtyAvailable ?? 0}
          </li>
        ))}
      </ul>
    </div>
  );
}