import React from 'react';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function MonthYearNav({ year, month, onChange, onYearClick, left = null }) {
  const shift = (months) => {
    const d = new Date(year, month + months, 1);
    onChange(d.getFullYear(), d.getMonth());
  };
  return (
    <div className="myn">
      <div className="myn-left">{left}</div>
      <div className="ph-nav">
        <button onClick={() => shift(-1)} aria-label="Previous month">❮</button>
        <span className="ph-month">{MONTHS[month]}</span>
        <button onClick={() => shift(1)} aria-label="Next month">❯</button>
      </div>
      <div className="ph-nav myn-year">
        <button onClick={() => shift(-12)} aria-label="Previous year">❮</button>
        {onYearClick
          ? <button className="ph-year" onClick={onYearClick} title="Open year view">{year}</button>
          : <span className="ph-year">{year}</span>}
        <button onClick={() => shift(12)} aria-label="Next year">❯</button>
      </div>
    </div>
  );
}
