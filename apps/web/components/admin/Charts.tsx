"use client";

import {
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";

interface ChartDataPoint {
  time: string;
  [key: string]: string | number;
}

interface PieDataPoint {
  name: string;
  value: number;
  color?: string;
}

export function PaymentsVolumeChart({ data }: { data: ChartDataPoint[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={256}>
      <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="payments-success" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#149447" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#149447" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="payments-failed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#C53030" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#C53030" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF3" vertical={false} />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 11, fill: "#5B6B83" }}
          axisLine={{ stroke: "#E7ECF3" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#5B6B83" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#fff",
            border: "1px solid #E7ECF3",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
          labelStyle={{ color: "#0B1220", fontWeight: 600 }}
          formatter={(value: number) => [`KES ${value.toLocaleString()}`, "Volume"]}
        />
        <Legend />
        <Area
          type="monotone"
          dataKey="success"
          stroke="#149447"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#payments-success)"
          name="Successful"
        />
        <Area
          type="monotone"
          dataKey="failed"
          stroke="#C53030"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#payments-failed)"
          name="Failed"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RevenueTrendChart({ data }: { data: ChartDataPoint[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={256}>
      <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF3" vertical={false} />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 11, fill: "#5B6B83" }}
          axisLine={{ stroke: "#E7ECF3" }}
          tickLine={false}
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11, fill: "#5B6B83" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) => value >= 1000 ? `KES ${(value / 1000).toFixed(1)}k` : `KES ${value}`}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 11, fill: "#5B6B83" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#fff",
            border: "1px solid #E7ECF3",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
          formatter={(value: number, name: string) => {
            if (name === "count") return [`${value} payments`, "Count"];
            return [`KES ${value.toLocaleString()}`, "Revenue"];
          }}
        />
        <Legend />
        <Bar
          yAxisId="left"
          dataKey="volume"
          name="Revenue (KES)"
          fill="#0F5BFF"
          radius={[4, 4, 0, 0]}
          maxBarSize={30}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="count"
          name="Payment Count"
          stroke="#149447"
          strokeWidth={2}
          dot={{ r: 4, strokeWidth: 2 }}
          activeDot={{ r: 6, strokeWidth: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function PaymentMethodDistributionChart({ data }: { data: PieDataPoint[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted">
        No data available
      </div>
    );
  }

  const COLORS = ["#0F5BFF", "#149447", "#B7791F", "#C53030", "#8B5CF6", "#EC4899", "#06B6D4"];

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
          dataKey="value"
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
          labelLine={false}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: "#fff",
            border: "1px solid #E7ECF3",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
          formatter={(value: number) => [`KES ${value.toLocaleString()}`, "Amount"]}
        />
        <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function TenantPerformanceChart({ data }: { data: Array<{ name: string; volume: number; payments: number }> }) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "#5B6B83" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) => value >= 1000000 ? `${(value / 1000000).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
        />
        <YAxis
          dataKey="name"
          type="category"
          tick={{ fontSize: 11, fill: "#5B6B83" }}
          axisLine={false}
          tickLine={false}
          width={140}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#fff",
            border: "1px solid #E7ECF3",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
          formatter={(value: number, name: string) => {
            if (name === "payments") return [`${value} payments`, "Payments"];
            return [`KES ${value.toLocaleString()}`, "Volume"];
          }}
        />
        <Legend />
        <Bar dataKey="volume" name="Volume (KES)" fill="#0F5BFF" radius={[0, 4, 4, 0]} maxBarSize={30} />
        <Bar dataKey="payments" name="Payments" fill="#149447" radius={[0, 4, 4, 0]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function QueueBacklogChart({ data }: { data: Array<{ queue: string; waiting: number; active: number; failed: number }> }) {
  if (!data || data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-muted">
        No queue data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: "#5B6B83" }} axisLine={false} tickLine={false} />
        <YAxis dataKey="queue" type="category" tick={{ fontSize: 10, fill: "#5B6B83" }} axisLine={false} tickLine={false} width={140} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#fff",
            border: "1px solid #E7ECF3",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        />
        <Legend />
        <Bar dataKey="waiting" name="Waiting" fill="#B7791F" radius={[0, 4, 4, 0]}           maxBarSize={20} />
        <Bar dataKey="active" name="Active" fill="#0F5BFF" radius={[0, 4, 4, 0]}           maxBarSize={20} />
        <Bar dataKey="failed" name="Failed" fill="#C53030" radius={[0, 4, 4, 0]}           maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LedgerHealthChart({ data }: { data: Array<{ time: string; balanced: number; unbalanced: number }> }) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted">
        No ledger data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={256}>
      <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="ledger-balanced" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#149447" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#149447" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="ledger-unbalanced" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#C53030" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#C53030" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF3" vertical={false} />
        <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#5B6B83" }} axisLine={{ stroke: "#E7ECF3" }} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#5B6B83" }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#fff",
            border: "1px solid #E7ECF3",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        />
        <Legend />
        <Area type="monotone" dataKey="balanced" stroke="#149447" strokeWidth={2} fillOpacity={1} fill="url(#ledger-balanced)" name="Balanced" />
        <Area type="monotone" dataKey="unbalanced" stroke="#C53030" strokeWidth={2} fillOpacity={1} fill="url(#ledger-unbalanced)" name="Unbalanced" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RealTimeMetricCard({ label, value, change, trend }: { label: string; value: string | number; change?: string; trend?: "up" | "down" | "neutral" }) {
  return (
    <div className="rounded-card border border-borderline bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-ink">{value}</p>
      {change && (
        <p className={`mt-1 text-xs font-medium ${trend === "up" ? "text-success" : trend === "down" ? "text-danger" : "text-muted"}`}>
          {trend === "up" ? "▲" : trend === "down" ? "▼" : "●"} {change}
        </p>
      )}
    </div>
  );
}