import React, { useState, useEffect, useMemo } from 'react';

window.tableColor = '#494949';

/* Checks if the order is late. */
const isLate = (dateString) => {
  if (!dateString) return 0;
  const today = new Date();
  const shipDate = new Date(dateString);
  const diffTime = today - shipDate;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

/* Flags items that do not have enough stock on hand */
/* Flags items that do not have enough stock available */
const isShortInventory = (item) => {
  const qtyAvailable = Number(
    item.QtyAvailable ?? item.qtyavailable ?? 0
  );
  const qtyOrdered = Number(
    item.QtyOrdered ?? item.qtyordered ?? 0
  );

  // Short if available stock is less than what this order line needs
  return qtyAvailable < qtyOrdered;
};

const isClosed = (item) => {
  const status = item.OrderStatus ?? item.orderstatus;
  return status === "Closed" || status === "Cancelled";
};

export default function App() {
  const [orders, setOrders] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLines, setTotalLines] = useState(0);
  const [loading, setLoading] = useState(false);
  const [totalValue, setTotalValue] = useState(0);
  const itemsPerPage = 15;
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE_URL}/orders?page=${currentPage}&limit=${itemsPerPage}`)
      .then((res) => {
        if (!res.ok) throw new Error('Network response was not ok');
        return res.json();
      })
      .then((data) => {
        if (data && Array.isArray(data.data)) {
          setOrders(data.data);
          setTotalPages(data.totalPages || 1);
          setTotalLines(data.total || data.data.length);
          setTotalValue(data.totalValue || 0);
        } else if (Array.isArray(data)) {
          setOrders(data);
          setTotalPages(Math.max(1, Math.ceil(data.length / itemsPerPage)));
          setTotalLines(data.length);
        } else {
          setOrders([]);
        }
      })
      .catch((err) => {
        console.error("Fetch failed:", err);
        setOrders([]);
      })
      .finally(() => setLoading(false));
  }, [currentPage]);

  const visibleOrders = useMemo(() => {
    if (!Array.isArray(orders)) return [];

    // Identify order numbers that have AT LEAST ONE short item on a "Regular" delivery order
    const regularOrdersWithShortage = new Set(
      orders
        .filter((item) => {
          const deliveryType = item.DeliveryType ?? item.deliveryType ?? item.deliverytype;
          // Treat non-Partial orders as complete-order holds
          const isRegular = String(deliveryType).trim().toLowerCase() !== 'partial';
          return isRegular && isShortInventory(item);
        })
        .map((item) => item.orderNumber ?? item.ordernumber)
    );

    // Filter lines based on delivery type rules
    const filtered = orders.filter((item) => {
      if (isClosed(item)) return false;

      const orderNum = item.orderNumber ?? item.ordernumber;
      const deliveryType = item.DeliveryType ?? item.deliveryType ?? item.deliverytype;
      const isPartial = String(deliveryType).trim().toLowerCase() === 'partial';

      if (isPartial) {
        // Partial: Hide ONLY this specific line if it is short
        if (isShortInventory(item)) return false;
      } else {
        // Regular: Hide ALL lines if ANY line in this order is short
        if (regularOrdersWithShortage.has(orderNum)) return false;
      }

      return true;
    });

    return filtered.sort((a, b) => {
      const dateA = new Date(a.ShipDate ?? a.shipdate ?? 0).getTime();
      const dateB = new Date(b.ShipDate ?? b.shipdate ?? 0).getTime();

      if (dateA !== dateB) {
        return dateA - dateB;
      }

      const orderA = Number(a.orderNumber ?? a.ordernumber ?? 0);
      const orderB = Number(b.orderNumber ?? b.ordernumber ?? 0);
      return orderA - orderB;
    });
  }, [orders]);

  const pageTotalValue = useMemo(() => {
    return visibleOrders.reduce((sum, item) => {
      const val = Number(item.GrossPrice ?? item.grossprice ?? item.Value ?? 0);
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
  }, [visibleOrders]);

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages));
  };

  const handleSyncClick = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/run-sync`, {
        method: 'POST',
      });
      const data = await response.json();
      alert(data.status);
    } catch (error) {
      console.error('Failed to trigger sync:', error);
    }
    window.location.reload();
  };

  return (
    <div style={{ padding: '0px', fontFamily: 'sans-serif' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '15px',
          marginBottom: '15px',
        }}
      >
        <h1 style={{ margin: 0, color: '#0f0f0f' }}>Open Orders</h1>

        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginLeft: 'auto' }}>
          <div style={{ color: '#0f0f0f' }}>
            Lines Overdue: <b style={{ color: '#f70c0c', fontSize: '24px', marginTop: '20px' }}>{totalLines}</b>
          </div>
          <button onClick={handleSyncClick} style={{ fontSize: '20px' }}>
            Sync cache
          </button>
          <button
            onClick={handlePrevPage}
            disabled={currentPage === 1 || loading}
            style={{
              padding: '8px 16px',
              cursor: currentPage === 1 || loading ? 'not-allowed' : 'pointer',
              opacity: currentPage === 1 || loading ? 0.5 : 1,
            }}
          >
            <span className="operator">&lt;</span>
          </button>

          <h2 style={{ margin: 0, minWidth: '20px', textAlign: 'center', fontSize: '24px', color: '#0f0f0f' }}>
            {currentPage} / {totalPages}
          </h2>

          <button
            onClick={handleNextPage}
            disabled={currentPage >= totalPages || loading}
            style={{
              padding: '8px 16px',
              cursor: currentPage >= totalPages || loading ? 'not-allowed' : 'pointer',
              opacity: currentPage >= totalPages || loading ? 0.5 : 1,
            }}
          >
            <span className="operator">&gt;</span>
          </button>
        </div>
      </div>

      <div
        style={{
          borderRadius: '12px',
          overflow: 'hidden',
          width: '100%',
          boxShadow: '0 4px 8px rgba(0, 0, 0, 0.25)',
        }}
      >
        <table
          style={{
            width: '100%',
            textAlign: 'left',
            borderCollapse: 'collapse',
            margin: 0,
          }}
        >
          <thead>
            <tr style={{ backgroundColor: window.tableColor, color: '#ffffff' }}>
              <th style={{ padding: '12px' }}>Order #</th>
              <th style={{ padding: '12px' }}>Type</th>
              <th style={{ padding: '12px' }}>Customer</th>
              <th style={{ padding: '12px' }}>Product Code</th>
              <th style={{ padding: '12px' }}>Product Name</th>
              <th style={{ padding: '12px', textAlign: 'center' }}>Ship Date</th>
              <th style={{ padding: '12px' }}>Value</th>
              <th style={{ padding: '12px' }}>Qty Ordered</th>
              <th style={{ padding: '12px' }}>On Hand</th>
              <th style={{ padding: '12px' }}>Allocated</th>
              <th style={{ padding: '12px' }}>Qty Available</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="11" style={{ textAlign: 'center', padding: '24px', color: '#0f0f0f' }}>
                  Loading orders...
                </td>
              </tr>
            ) : visibleOrders.length === 0 ? (
              <tr>
                <td colSpan="11" style={{ textAlign: 'center', padding: '24px', color: '#0f0f0f' }}>
                  No open orders found.
                </td>
              </tr>
            ) : (
              visibleOrders.map((item, index) => {
                const orderNum = item.orderNumber ?? item.ordernumber;
                const shipDate = item.ShipDate ?? item.shipdate;
                const deliveryType = item.DeliveryType ?? item.deliveryType ?? item.deliverytype ?? 'Regular';
                const lateDays = isLate(shipDate);

                return (
                  <tr key={item.id ?? `${orderNum}-${index}`} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '12px' }}>{orderNum}</td>
                    <td style={{ padding: '12px' }}>{deliveryType}</td>
                    <td style={{ padding: '12px' }}>
                      {item.CustName ?? item.custName ?? item.custname ?? 'N/A'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {item.OldProductNumber ?? item.oldproductnumber ?? 'N/A'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {item.ProductName ?? item.productname ?? 'N/A'}
                    </td>
                    <td style={{ padding: '5px', textAlign: 'center' }}>
                      <span
                        style={{
                          textAlign: 'center',
                          fontWeight: '600',
                          backgroundColor:
                            lateDays >= 14
                              ? '#fee2e2'
                              : lateDays >= 3
                              ? '#fef3c7'
                              : 'transparent',
                          color:
                            lateDays >= 14
                              ? '#991b1b'
                              : lateDays >= 3
                              ? '#92400e'
                              : 'inherit',
                          borderRadius: '6px',
                          margin: '0px',
                          padding: '4px 8px',
                          display: 'inline-block',
                        }}
                      >
                        {shipDate ?? 'N/A'}
                      </span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      {(item.GrossPrice ?? item.grossprice) != null
                        ? `$${item.GrossPrice ?? item.grossprice}`
                        : '$0'}
                    </td>
                    <td style={{ padding: '12px' }}>{item.QtyOrdered ?? item.qtyordered ?? 0}</td>
                    <td style={{ padding: '12px' }}>{item.OnHandPKG ?? item.onhandpkg ?? 0}</td>
                    <td style={{ padding: '12px' }}>{item.AllocatedQty ?? item.allocatedqty ?? 0}</td>
                    <td style={{ padding: '12px' }}>{item.QtyAvailable ?? item.qtyavailable ?? 0}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}