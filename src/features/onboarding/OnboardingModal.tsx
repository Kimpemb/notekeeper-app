import React, { useState } from 'react';
import {
  WelcomeIcon,
  WorkspaceIcon,
  EditorIcon,
  GraphIcon,
  CheckIcon,
} from './icons';
import {
  WelcomeStep,
  WorkspaceStep,
  EditorStep,
  GraphStep,
  DoneStep,
} from './steps';

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = 5;

  const steps = [
    { title: null, description: null, icon: WelcomeIcon, component: WelcomeStep },
    { title: 'Your workspace', description: 'The sidebar keeps all your notes organised. You can nest notes, drag to reorder, and search instantly.', icon: WorkspaceIcon, component: WorkspaceStep },
    { title: 'A distraction-free editor', description: 'Just start typing. Use the slash menu to insert blocks — headings, code, tables, callouts, and more.', icon: EditorIcon, component: EditorStep },
    { title: 'See how your ideas connect', description: 'Link notes with [[double brackets]] and watch the graph build itself. Patterns emerge you wouldn\'t notice in a list.', icon: GraphIcon, component: GraphStep },
    { title: 'You\'re all set', description: 'Idemora gets better the more you write. Start anywhere — a quick note, a thought, a task. You can revisit this tour anytime from Settings.', icon: CheckIcon, component: DoneStep },
  ];

  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleFinish();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleFinish = () => {
    onComplete();
  };

  const CurrentStepComponent = steps[currentStep].component;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-6">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-[480px] p-8 relative shadow-2xl">
        {/* Skip button */}
        <button
          onClick={handleFinish}
          className="absolute top-5 right-5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          Skip
        </button>

        {/* Progress bar */}
        <div className="flex gap-1 mb-7">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`flex-1 h-0.5 rounded-full transition-colors ${
                i <= currentStep
                  ? 'bg-zinc-900 dark:bg-zinc-100'
                  : 'bg-zinc-200 dark:bg-zinc-800'
              }`}
            />
          ))}
        </div>

        {/* Icon */}
        <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center mb-5">
          {React.createElement(steps[currentStep].icon, { className: "w-4.5 h-4.5 text-zinc-600 dark:text-zinc-400" })}
        </div>

        {/* Title & Description */}
        {steps[currentStep].title && (
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">
            {steps[currentStep].title}
          </h2>
        )}
        {steps[currentStep].description && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6">
            {steps[currentStep].description}
          </p>
        )}

        {/* Step content */}
        <CurrentStepComponent />

        {/* Footer navigation */}
        <div className="flex items-center justify-between mt-6">
          <span className="text-xs text-zinc-400">
            {currentStep + 1} of {totalSteps}
          </span>
          <div className="flex gap-2">
            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:opacity-80 transition-opacity"
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-80 transition-opacity"
            >
              {currentStep === totalSteps - 1 ? 'Start writing' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};