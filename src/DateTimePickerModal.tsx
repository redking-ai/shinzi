import React, { useState, useMemo } from 'react';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, X } from 'lucide-react';
import './DateTimePickerModal.css';

interface DateTimePickerModalProps {
  title: string;
  initialValue?: string;
  showTime?: boolean;
  onConfirm: (formattedValue: string) => void;
  onConfirmDate?: (day: number, month: number, year: number) => void;
  onClose: () => void;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export const DateTimePickerModal: React.FC<DateTimePickerModalProps> = ({
  title,
  initialValue,
  showTime = true,
  onConfirm,
  onConfirmDate,
  onClose,
}) => {
  // Parse initial date or default to now
  const now = useMemo(() => new Date(), []);
  const initialDate = useMemo(() => {
    if (!initialValue) return new Date();
    const parsed = new Date(initialValue);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [initialValue]);

  const [currentYear, setCurrentYear] = useState(initialDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(initialDate.getMonth());
  const [selectedDay, setSelectedDay] = useState(initialDate.getDate());

  // Time state (12-hour format)
  const initialHours = initialDate.getHours();
  const [hour, setHour] = useState(
    initialHours === 0 ? 12 : initialHours > 12 ? initialHours - 12 : initialHours
  );
  const [minute, setMinute] = useState(
    Math.round(initialDate.getMinutes() / 5) * 5 % 60
  );
  const [ampm, setAmpm] = useState<'AM' | 'PM'>(initialHours >= 12 ? 'PM' : 'AM');

  // Days in current month
  const daysInMonth = useMemo(() => {
    return new Date(currentYear, currentMonth + 1, 0).getDate();
  }, [currentYear, currentMonth]);

  // First day of the month (0 = Sun, 1 = Mon, ..., 6 = Sat)
  const firstDayWeekday = useMemo(() => {
    return new Date(currentYear, currentMonth, 1).getDay();
  }, [currentYear, currentMonth]);

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleConfirm = () => {
    if (onConfirmDate) {
      onConfirmDate(selectedDay, currentMonth + 1, currentYear);
    }
    const formattedMinute = String(minute).padStart(2, '0');
    const formatted = showTime
      ? `${SHORT_MONTHS[currentMonth]} ${selectedDay}, ${currentYear} at ${hour}:${formattedMinute} ${ampm}`
      : `${SHORT_MONTHS[currentMonth]} ${selectedDay}, ${currentYear}`;
    onConfirm(formatted);
  };

  return (
    <div className="shc-dtp-backdrop" onClick={onClose}>
      <div className="shc-dtp-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="shc-dtp-header">
          <div className="shc-dtp-title">
            <CalendarIcon size={18} className="shc-dtp-icon" />
            <span>{title}</span>
          </div>
          <button type="button" className="shc-dtp-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Calendar Section (Full Black, White Text) */}
        <div className="shc-dtp-calendar-card">
          {/* Month / Year Navigator */}
          <div className="shc-dtp-month-bar">
            <button type="button" className="shc-dtp-nav-btn" onClick={prevMonth} aria-label="Previous month">
              <ChevronLeft size={20} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={currentMonth}
                onChange={(e) => setCurrentMonth(Number(e.target.value))}
                style={{
                  background: '#18191c',
                  color: '#ffffff',
                  border: '1px solid #35363c',
                  borderRadius: 6,
                  padding: '4px 6px',
                  fontWeight: 600,
                  fontSize: 13,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {MONTH_NAMES.map((m, idx) => (
                  <option key={m} value={idx}>{m}</option>
                ))}
              </select>
              <select
                value={currentYear}
                onChange={(e) => setCurrentYear(Number(e.target.value))}
                style={{
                  background: '#18191c',
                  color: '#ffffff',
                  border: '1px solid #35363c',
                  borderRadius: 6,
                  padding: '4px 6px',
                  fontWeight: 600,
                  fontSize: 13,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {Array.from({ length: 100 }).map((_, idx) => {
                  const yr = now.getFullYear() - idx;
                  return <option key={yr} value={yr}>{yr}</option>;
                })}
              </select>
            </div>
            <button type="button" className="shc-dtp-nav-btn" onClick={nextMonth} aria-label="Next month">
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Weekday Labels */}
          <div className="shc-dtp-weekdays">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w) => (
              <span key={w} className="shc-dtp-weekday">{w}</span>
            ))}
          </div>

          {/* Days Grid */}
          <div className="shc-dtp-days-grid">
            {Array.from({ length: firstDayWeekday }).map((_, i) => (
              <span key={`empty-${i}`} className="shc-dtp-day-empty" />
            ))}

            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const isSelected = day === selectedDay;
              const isToday =
                day === now.getDate() &&
                currentMonth === now.getMonth() &&
                currentYear === now.getFullYear();

              return (
                <button
                  key={`day-${day}`}
                  type="button"
                  className={`shc-dtp-day ${isSelected ? 'shc-dtp-day-selected' : ''} ${isToday && !isSelected ? 'shc-dtp-day-today' : ''}`}
                  onClick={() => setSelectedDay(day)}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time / Clock Selector Section */}
        {showTime && (
          <div className="shc-dtp-time-card">
            <div className="shc-dtp-time-header">
              <Clock size={16} />
              <span>Time</span>
            </div>

            <div className="shc-dtp-time-controls">
              {/* Hours */}
              <div className="shc-dtp-select-wrap">
                <label className="shc-dtp-label">Hour</label>
                <select
                  className="shc-dtp-select"
                  value={hour}
                  onChange={(e) => setHour(Number(e.target.value))}
                >
                  {Array.from({ length: 12 }).map((_, i) => {
                    const h = i + 1;
                    return (
                      <option key={`h-${h}`} value={h}>
                        {String(h).padStart(2, '0')}
                      </option>
                    );
                  })}
                </select>
              </div>

              <span className="shc-dtp-colon">:</span>

              {/* Minutes */}
              <div className="shc-dtp-select-wrap">
                <label className="shc-dtp-label">Minute</label>
                <select
                  className="shc-dtp-select"
                  value={minute}
                  onChange={(e) => setMinute(Number(e.target.value))}
                >
                  {Array.from({ length: 12 }).map((_, i) => {
                    const m = i * 5;
                    return (
                      <option key={`m-${m}`} value={m}>
                        {String(m).padStart(2, '0')}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* AM / PM Toggle */}
              <div className="shc-dtp-ampm-wrap">
                <button
                  type="button"
                  className={`shc-dtp-ampm-btn ${ampm === 'AM' ? 'shc-dtp-ampm-active' : ''}`}
                  onClick={() => setAmpm('AM')}
                >
                  AM
                </button>
                <button
                  type="button"
                  className={`shc-dtp-ampm-btn ${ampm === 'PM' ? 'shc-dtp-ampm-active' : ''}`}
                  onClick={() => setAmpm('PM')}
                >
                  PM
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm Footer Button (White with Black Text) */}
        <button type="button" className="shc-dtp-confirm-btn" onClick={handleConfirm}>
          {showTime ? 'Set Date & Time' : 'Set Date'}
        </button>
      </div>
    </div>
  );
};
