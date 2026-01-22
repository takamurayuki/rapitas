"use client";
import { Tags } from "lucide-react";
import CategoryManager, {
  type CategoryManagerConfig,
} from "@/components/category/CategoryManager";

const config: CategoryManagerConfig = {
  title: "ラベル一覧",
  titleIcon: Tags,
  itemName: "ラベル",
  endpoint: "labels",
  accentColor: "indigo",
  defaultColor: "#6366F1",
  defaultIcon: "Tag",
  showDefaultButton: false,
};

export default function LabelsPage() {
  return <CategoryManager config={config} />;
}
