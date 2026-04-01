/**
 * Achievement Toast Component
 *
 * Displays animated toast notifications when achievements are unlocked
 * in the rapitas task management system.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy, Star, Crown, Award, Sparkles, X, CheckCircle
} from 'lucide-react';
import type { AchievementNotification } from '../../types/achievement';
import { getRarityColor } from '../../data/achievements';

interface AchievementToastProps {
  notifications: AchievementNotification[];
  onDismiss: (notificationId: string) => void;
  onMarkAsShown: (notificationId: string) => void;
  maxVisible?: number;
  autoHideDuration?: number;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

interface SingleToastProps {
  notification: AchievementNotification;
  onDismiss: () => void;
  onMarkAsShown: () => void;
  autoHideDuration: number;
  index: number;
}

/**
 * Single achievement toast component
 * 単一実績トーストコンポーネント
 */
const SingleToast: React.FC<SingleToastProps> = ({
  notification,
  onDismiss,
  onMarkAsShown,
  autoHideDuration,
  index
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [progress, setProgress] = useState(100);

  const rarityColor = getRarityColor(notification.rarity);

  // Auto-hide timer
  useEffect(() => {
    if (autoHideDuration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onDismiss, 300); // Allow exit animation
      }, autoHideDuration);

      // Progress animation
      const progressTimer = setInterval(() => {
        setProgress(prev => {
          const newProgress = prev - (100 / (autoHideDuration / 100));
          return Math.max(0, newProgress);
        });
      }, 100);

      return () => {
        clearTimeout(timer);
        clearInterval(progressTimer);
      };
    }
  }, [autoHideDuration, onDismiss]);

  // Mark as shown when component mounts
  useEffect(() => {
    if (!notification.isShown) {
      onMarkAsShown();
    }
  }, [notification.isShown, onMarkAsShown]);

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(onDismiss, 300);
  };

  const IconComponent = {
    Trophy, Star, Crown, Award, Sparkles, CheckCircle
  }[notification.icon] || Trophy;

  const getRarityEmoji = (rarity: string) => {
    switch (rarity) {
      case 'legendary': return '🏆';
      case 'epic': return '💜';
      case 'rare': return '💙';
      case 'common': return '💚';
      default: return '🏅';
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, x: 400, scale: 0.3 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 400, scale: 0.3 }}
          transition={{
            type: "spring",
            stiffness: 500,
            damping: 30,
            delay: index * 0.1
          }}
          className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden max-w-sm w-full"
          style={{
            boxShadow: `0 20px 40px ${rarityColor}20, 0 0 30px ${rarityColor}10`
          }}
        >
          {/* Rarity border */}
          <div
            className="absolute top-0 left-0 w-full h-1"
            style={{ backgroundColor: rarityColor }}
          />

          {/* Progress bar */}
          {autoHideDuration > 0 && (
            <motion.div
              className="absolute bottom-0 left-0 h-1 bg-gray-300 dark:bg-gray-600"
              style={{
                width: `${progress}%`,
                backgroundColor: rarityColor
              }}
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: autoHideDuration / 1000, ease: "linear" }}
            />
          )}

          <div className="p-4">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center space-x-2">
                <span className="text-lg">{getRarityEmoji(notification.rarity)}</span>
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  実績解除！
                </span>
              </div>
              <button
                onClick={handleDismiss}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex items-center space-x-3 mb-3">
              <motion.div
                className="p-3 rounded-lg flex-shrink-0"
                style={{ backgroundColor: `${rarityColor}20`, color: rarityColor }}
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 300 }}
              >
                <IconComponent className="w-6 h-6" />
              </motion.div>

              <div className="flex-1 min-w-0">
                <motion.h3
                  className="text-lg font-semibold text-gray-900 dark:text-white"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  {notification.achievementName}
                </motion.h3>
                <motion.p
                  className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  {notification.description}
                </motion.p>
              </div>
            </div>

            {/* Points reward */}
            <motion.div
              className="flex items-center justify-between"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5, type: "spring", stiffness: 300 }}
            >
              <div className="flex items-center space-x-1 text-yellow-500">
                <Star className="w-4 h-4 fill-current" />
                <span className="font-semibold">+{notification.pointsReward}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">ポイント</span>
              </div>

              <div className="text-xs text-gray-400 dark:text-gray-500">
                {new Date(notification.timestamp).toLocaleTimeString('ja-JP', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </div>
            </motion.div>
          </div>

          {/* Sparkle animation overlay */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 2, delay: 0.5 }}
          >
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-1 h-1 rounded-full"
                style={{ backgroundColor: rarityColor }}
                initial={{
                  left: "50%",
                  top: "50%",
                  scale: 0
                }}
                animate={{
                  left: `${20 + Math.random() * 60}%`,
                  top: `${20 + Math.random() * 60}%`,
                  scale: [0, 1, 0],
                }}
                transition={{
                  duration: 1.5,
                  delay: 0.2 + i * 0.1,
                  ease: "easeOut"
                }}
              />
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/**
 * Achievement toast container component
 * 実績トーストコンテナコンポーネント
 */
export const AchievementToast: React.FC<AchievementToastProps> = ({
  notifications,
  onDismiss,
  onMarkAsShown,
  maxVisible = 3,
  autoHideDuration = 5000,
  position = 'top-right'
}) => {
  // Only show unshown notifications, limited by maxVisible
  const visibleNotifications = notifications
    .filter(n => !n.isShown)
    .slice(0, maxVisible)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Position classes
  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
  };

  if (visibleNotifications.length === 0) {
    return null;
  }

  return (
    <div
      className={`fixed ${positionClasses[position]} z-50 space-y-3 pointer-events-none`}
      style={{ maxWidth: '400px' }}
    >
      <div className="space-y-3 pointer-events-auto">
        <AnimatePresence>
          {visibleNotifications.map((notification, index) => (
            <SingleToast
              key={notification.id}
              notification={notification}
              onDismiss={() => onDismiss(notification.id)}
              onMarkAsShown={() => onMarkAsShown(notification.id)}
              autoHideDuration={autoHideDuration}
              index={index}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Additional notifications indicator */}
      {notifications.filter(n => !n.isShown).length > maxVisible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <div className="inline-flex items-center px-3 py-2 bg-gray-800 dark:bg-gray-700 text-white text-sm rounded-lg shadow-lg">
            <Sparkles className="w-4 h-4 mr-2" />
            +{notifications.filter(n => !n.isShown).length - maxVisible} 個の実績
          </div>
        </motion.div>
      )}
    </div>
  );
};