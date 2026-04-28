'use client';
import { Tags } from 'lucide-react';
import { useTranslations } from 'next-intl';
import CategoryManager, { type CategoryManagerConfig } from '@/components/category/CategoryManager';

export default function LabelsPage() {
  const t = useTranslations('labels');

  const config: CategoryManagerConfig = {
    title: t('title'),
    titleIcon: Tags,
    itemName: t('itemName'),
    endpoint: 'labels',
    accentColor: 'indigo',
    defaultColor: '#6366F1',
    defaultIcon: 'Tag',
    showDefaultButton: false,
  };

  return <CategoryManager config={config} />;
}
