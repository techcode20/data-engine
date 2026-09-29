import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

export function GaugeChart({ score, color }: { score: number; color: string }) {
  const data = [
    { name: "score", value: score },
    { name: "rest", value: Math.max(0, 100 - score) },
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" startAngle={210} endAngle={-30} innerRadius="72%" outerRadius="100%" strokeWidth={0} isAnimationActive={false}>
          <Cell fill={color} />
          <Cell fill="rgba(255,255,255,0.08)" />
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
