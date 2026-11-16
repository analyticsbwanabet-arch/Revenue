import { Suspense } from "react";
import DailyEntry from "./DailyEntry";

export default function EntryPage() {
  return <Suspense fallback={<div style={{ color: "#636363" }}>Loading...</div>}><DailyEntry /></Suspense>;
}
