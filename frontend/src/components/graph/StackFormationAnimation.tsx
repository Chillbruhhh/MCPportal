'use client'

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { XYPosition } from '@xyflow/react'
import { FaLayerGroup, FaPlus } from 'react-icons/fa6'
import Confetti from 'react-confetti'

interface StackFormationAnimationProps {
  isVisible: boolean
  position?: XYPosition
  serverCount: number
  stackName?: string
  onComplete?: () => void
}

export function StackFormationAnimation({
  isVisible,
  position = { x: 0, y: 0 },
  serverCount,
  stackName = 'New Stack',
  onComplete
}: StackFormationAnimationProps) {
  const [showConfetti, setShowConfetti] = React.useState(false)
  const [animationStage, setAnimationStage] = React.useState<'merging' | 'forming' | 'complete'>('merging')

  React.useEffect(() => {
    if (!isVisible) {
      setAnimationStage('merging')
      setShowConfetti(false)
      return
    }

    // Animation sequence
    const timer1 = setTimeout(() => setAnimationStage('forming'), 800)
    const timer2 = setTimeout(() => {
      setAnimationStage('complete')
      setShowConfetti(true)
    }, 1600)
    const timer3 = setTimeout(() => {
      setShowConfetti(false)
      onComplete?.()
    }, 3000)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }, [isVisible, onComplete])

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Confetti */}
          {showConfetti && (
            <Confetti
              width={window.innerWidth}
              height={window.innerHeight}
              recycle={false}
              numberOfPieces={100}
              gravity={0.1}
              colors={['hsl(var(--primary))', 'hsl(var(--accent))', '#10b981', '#f59e0b', '#8b5cf6']}
            />
          )}

          {/* Animation Container */}
          <motion.div
            className="absolute pointer-events-none z-50"
            style={{
              left: position.x - 100,
              top: position.y - 50,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Server Merge Animation */}
            {animationStage === 'merging' && (
              <div className="relative">
                {/* Individual server representations */}
                {Array.from({ length: serverCount }).map((_, index) => (
                  <motion.div
                    key={index}
                    className="absolute w-16 h-16 bg-card border-2 border-border rounded-xl flex items-center justify-center shadow-lg"
                    initial={{
                      x: (index - serverCount / 2) * 60,
                      y: 0,
                      scale: 1,
                      rotate: 0
                    }}
                    animate={{
                      x: 0,
                      y: 0,
                      scale: 0.8,
                      rotate: index * 10 - 20
                    }}
                    transition={{
                      duration: 0.8,
                      ease: "easeInOut",
                      delay: index * 0.1
                    }}
                  >
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                      <div className="w-4 h-4 bg-blue-500 rounded" />
                    </div>
                  </motion.div>
                ))}

                {/* Merge effect particles */}
                {Array.from({ length: 20 }).map((_, index) => (
                  <motion.div
                    key={`particle-${index}`}
                    className="absolute w-2 h-2 bg-primary rounded-full"
                    initial={{
                      x: Math.random() * 200 - 100,
                      y: Math.random() * 200 - 100,
                      opacity: 0,
                      scale: 0
                    }}
                    animate={{
                      x: 0,
                      y: 0,
                      opacity: [0, 1, 0],
                      scale: [0, 1, 0]
                    }}
                    transition={{
                      duration: 0.8,
                      delay: Math.random() * 0.5,
                      ease: "easeOut"
                    }}
                  />
                ))}
              </div>
            )}

            {/* Stack Formation Animation */}
            {animationStage === 'forming' && (
              <motion.div
                className="relative"
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ duration: 0.8, ease: "backOut" }}
              >
                {/* Stack container */}
                <div className="w-32 h-20 bg-gradient-to-br from-primary/20 to-accent/20 border-2 border-primary rounded-xl flex items-center justify-center shadow-2xl">
                  <FaLayerGroup className="w-8 h-8 text-primary" />
                </div>

                {/* Formation glow */}
                <motion.div
                  className="absolute inset-0 bg-primary/30 rounded-xl blur-xl"
                  animate={{
                    scale: [1, 1.5, 1],
                    opacity: [0.3, 0.6, 0.3]
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: 2,
                    ease: "easeInOut"
                  }}
                />

                {/* Success checkmark */}
                <motion.div
                  className="absolute -top-2 -right-2 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center"
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ duration: 0.3, delay: 0.5 }}
                >
                  <FaPlus className="w-4 h-4 text-white rotate-45" />
                </motion.div>
              </motion.div>
            )}

            {/* Completion Animation */}
            {animationStage === 'complete' && (
              <motion.div
                className="relative"
                initial={{ scale: 1 }}
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 0.5 }}
              >
                {/* Final stack */}
                <div className="w-40 h-24 bg-gradient-to-br from-primary to-accent border-2 border-primary rounded-xl flex flex-col items-center justify-center shadow-2xl text-white">
                  <FaLayerGroup className="w-6 h-6 mb-1" />
                  <div className="text-xs font-bold text-center px-2 leading-tight">
                    {stackName}
                  </div>
                </div>

                {/* Success badge */}
                <motion.div
                  className="absolute -top-3 -right-3 px-2 py-1 bg-green-500 text-white text-xs font-bold rounded-full"
                  initial={{ scale: 0, y: -10 }}
                  animate={{ scale: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.2 }}
                >
                  ✨ Created!
                </motion.div>

                {/* Celebration rings */}
                {Array.from({ length: 3 }).map((_, index) => (
                  <motion.div
                    key={`ring-${index}`}
                    className="absolute inset-0 border-2 border-primary rounded-xl"
                    initial={{ scale: 1, opacity: 0.8 }}
                    animate={{
                      scale: 1.5 + index * 0.3,
                      opacity: 0
                    }}
                    transition={{
                      duration: 1,
                      delay: index * 0.2,
                      ease: "easeOut"
                    }}
                  />
                ))}
              </motion.div>
            )}

            {/* Stack name label */}
            <motion.div
              className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 px-3 py-1 bg-background border border-border rounded-lg shadow-lg text-sm font-medium whitespace-nowrap"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              {stackName}
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

interface ServerMergeZoneProps {
  isActive: boolean
  position?: XYPosition
  serverCount: number
  previewName?: string
}

export function ServerMergeZone({
  isActive,
  position = { x: 0, y: 0 },
  serverCount,
  previewName = 'Drop to merge'
}: ServerMergeZoneProps) {
  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          className="absolute pointer-events-none z-40"
          style={{
            left: position.x - 75,
            top: position.y - 75,
          }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2 }}
        >
          {/* Drop zone circle */}
          <motion.div
            className="w-32 h-32 border-4 border-dashed border-primary rounded-full bg-primary/10 flex items-center justify-center"
            animate={{
              borderColor: ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--primary))'],
              scale: [1, 1.05, 1]
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          >
            <div className="text-center">
              <FaLayerGroup className="w-6 h-6 text-primary mx-auto mb-1" />
              <div className="text-xs font-bold text-primary">
                {serverCount} servers
              </div>
            </div>
          </motion.div>

          {/* Preview label */}
          <motion.div
            className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 px-3 py-1 bg-primary text-primary-foreground rounded-lg shadow-lg text-sm font-medium whitespace-nowrap"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            {previewName}
          </motion.div>

          {/* Magnetic effect particles */}
          {Array.from({ length: 8 }).map((_, index) => (
            <motion.div
              key={`magnetic-${index}`}
              className="absolute w-2 h-2 bg-primary/60 rounded-full"
              style={{
                left: `${50 + 40 * Math.cos((index * Math.PI * 2) / 8)}%`,
                top: `${50 + 40 * Math.sin((index * Math.PI * 2) / 8)}%`,
              }}
              animate={{
                scale: [0.5, 1, 0.5],
                opacity: [0.3, 0.8, 0.3],
                x: [0, Math.cos((index * Math.PI * 2) / 8) * 10, 0],
                y: [0, Math.sin((index * Math.PI * 2) / 8) * 10, 0],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                delay: index * 0.25,
                ease: "easeInOut"
              }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}