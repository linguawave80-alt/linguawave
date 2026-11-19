import { BarElement, CategoryScale, Chart as ChartJS, Filler, LinearScale, LineElement, PointElement, Tooltip, Legend, } from 'chart.js';
import { useEffect, useRef, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip, Legend);
const TEAL = '#14B8A6';
const MUTED = '#8B98A5';
const GRID = 'rgba(255,255,255,0.05)';
const tooltip = {
    backgroundColor: '#111A22', borderColor: '#1E2A35', borderWidth: 1, titleColor: '#E6EDF3',
    bodyColor: '#8B98A5', padding: 10, cornerRadius: 8, displayColors: false,
};
/** Canvas can't read CSS variables, so resolve the real (web font) family from the DOM before drawing. */
function useChartBox(height) {
    const ref = useRef(null);
    const [font, setFont] = useState(null);
    const [reduce, setReduce] = useState(false);
    useEffect(() => {
        if (ref.current)
            setFont(getComputedStyle(ref.current).fontFamily);
        setReduce(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }, []);
    const box = (children) => (<div className="chart-box" ref={ref} style={{ height }}>{font ? children : null}</div>);
    return { box, font: font || 'system-ui', reduce };
}
// Chart.js "progressive line" so the line draws in left to right.
function drawIn(n) {
    const total = 900;
    const step = total / Math.max(1, n);
    const prevY = (ctx) => ctx.index === 0
        ? ctx.chart.scales.y.getPixelForValue(ctx.chart.scales.y.min)
        : ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1].getProps(['y'], true).y;
    return {
        x: {
            type: 'number', easing: 'linear', duration: step, from: NaN,
            delay(ctx) { if (ctx.type !== 'data' || ctx.xStarted)
                return 0; ctx.xStarted = true; return ctx.index * step; },
        },
        y: {
            type: 'number', easing: 'linear', duration: step, from: prevY,
            delay(ctx) { if (ctx.type !== 'data' || ctx.yStarted)
                return 0; ctx.yStarted = true; return ctx.index * step; },
        },
    };
}
export function AccuracyLine({ labels, data, label = 'Accuracy', height = 260, zoom = false, highlightLast = false, }) {
    const { box, font, reduce } = useChartBox(height);
    const min = zoom && data.length ? Math.max(0, Math.floor((Math.min(...data) - 5) / 10) * 10) : 0;
    const lastIdx = data.length - 1;
    const isLast = (i) => highlightLast && i === lastIdx;
    return box(<Line data={{
            labels,
            datasets: [{
                    label, data, borderColor: TEAL, backgroundColor: 'rgba(20,184,166,0.10)',
                    pointBackgroundColor: highlightLast ? data.map((_, i) => (isLast(i) ? '#FFFFFF' : TEAL)) : TEAL,
                    pointBorderColor: TEAL,
                    pointBorderWidth: highlightLast ? data.map((_, i) => (isLast(i) ? 2.5 : 1)) : 1,
                    fill: true, tension: 0.35,
                    pointRadius: highlightLast ? data.map((_, i) => (isLast(i) ? 5 : 3)) : data.length > 30 ? 0 : 3,
                    pointHoverRadius: 6, borderWidth: 2,
                }],
        }} options={{
            responsive: true, maintainAspectRatio: false,
            animation: reduce ? false : drawIn(data.length),
            font: { family: font },
            color: MUTED,
            plugins: { legend: { display: false }, tooltip: { ...tooltip, callbacks: { label: (c) => ` ${c.parsed.y}%` } } },
            scales: {
                x: { grid: { display: false }, border: { display: false }, ticks: { color: MUTED, maxTicksLimit: 7 } },
                y: { min, max: 100, grid: { color: GRID }, border: { display: false }, ticks: { color: MUTED, callback: (v) => `${v}%` } },
            },
        }}/>);
}
export function CountBars({ labels, data, label = 'Sessions', height = 260, }) {
    const { box, font, reduce } = useChartBox(height);
    return box(<Bar data={{ labels, datasets: [{ label, data, backgroundColor: TEAL, hoverBackgroundColor: '#19C6B3', borderRadius: 4, maxBarThickness: 28 }] }} options={{
            responsive: true, maintainAspectRatio: false,
            animation: reduce ? false : { duration: 700, easing: 'easeOutQuart' },
            font: { family: font },
            color: MUTED,
            plugins: { legend: { display: false }, tooltip },
            scales: {
                x: { grid: { display: false }, border: { display: false }, ticks: { color: MUTED, maxTicksLimit: 7 } },
                y: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, ticks: { color: MUTED, precision: 0 } },
            },
        }}/>);
}
