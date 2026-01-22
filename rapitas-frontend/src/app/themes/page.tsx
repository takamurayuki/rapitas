"use client";
import { Palette } from "lucide-react";
import CategoryManager, {
  type CategoryManagerConfig,
} from "@/components/category/CategoryManager";

const config: CategoryManagerConfig = {
  title: "テーマ一覧",
  titleIcon: Palette,
  itemName: "テーマ",
  endpoint: "themes",
  accentColor: "purple",
  defaultColor: "#8B5CF6",
  defaultIcon: "Palette",
  showDefaultButton: true,
};

export default function ThemesPage() {
  return <CategoryManager config={config} />;
}
