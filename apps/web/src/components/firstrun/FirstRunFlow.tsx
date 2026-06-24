'use client';

/**
 * FirstRunFlow — guided "experience the magic" first-run experience.
 *
 * Renders FIRST_RUN_STEPS as a clean, centered card over a subtle backdrop.
 * Unlike the TourProvider spotlight (which anchors to DOM targets), this is a
 * deliberate centered-card flow so it never fights the tour's spotlight system.
 * As the user advances, we navigate the app via setActiveSection(step.section)
 * so they actually land on the right screen at each stage.
 *
 * Progress persists to preferences (magic_flow_step); finishing marks the run
 * celebrated + tour completed and fires a success toast.
 */

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FIRST_RUN_STEPS } from '../../lib/first-run-data';
import { useEAOSStore } from '../../store/eaos-store';
import { getPreference, setPreference } from '../../lib/storage';
import { notify } from '../../lib/notify';
import { modalVariants, fadeInUp, scaleIn } from '../../lib/animations';

export interface FirstRunFlowProps {
    open: boolean;
    onClose: () => void;
}

export function FirstRunFlow({ open, onClose }: FirstRunFlowProps) {
    const setActiveSection = useEAOSStore((s) => s.setActiveSection);
    const [index, setIndex] = useState(0);

    const total = FIRST_RUN_STEPS.length;
    const step = FIRST_RUN_STEPS[index];
    const isFirst = index === 0;
    const isLast = index === total - 1;

    // On open, resume from the last persisted step (if any) and navigate to it.
    useEffect(() => {
        if (!open) return;
        const savedId = getPreference('magic_flow_step');
        const resumeIdx = savedId
            ? FIRST_RUN_STEPS.findIndex((s) => s.id === savedId)
            : -1;
        setIndex(resumeIdx >= 0 ? resumeIdx : 0);
    }, [open]);

    // Whenever the active step changes, drive navigation + persist progress.
    useEffect(() => {
        if (!open || !step) return;
        if (step.section) setActiveSection(step.section);
        setPreference('magic_flow_step', step.id);
    }, [open, step, setActiveSection]);

    const finish = useCallback(() => {
        setPreference('first_run_celebrated', true);
        setPreference('tour_completed', true);
        notify('success', "You're all set ⚡", 'Connect a model, pick a skill, and let agents do the work. Restart this guide anytime from Settings.');
        onClose();
    }, [onClose]);

    const next = useCallback(() => {
        if (isLast) {
            finish();
        } else {
            setIndex((i) => Math.min(i + 1, total - 1));
        }
    }, [isLast, finish, total]);

    const back = useCallback(() => {
        setIndex((i) => Math.max(i - 1, 0));
    }, []);

    const skip = useCallback(() => {
        onClose();
    }, [onClose]);

    // Keyboard navigation while open.
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
            if (e.key === 'Escape') { e.preventDefault(); skip(); }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, next, back, skip]);

    return (
        <AnimatePresence>
            {open && step && (
                <motion.div
                    key="first-run-backdrop"
                    className="fixed inset-0 z-[200] flex items-center justify-center p-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    aria-modal="true"
                    role="dialog"
                    aria-labelledby="first-run-title"
                >
                    {/* Subtle backdrop — light, on-brand, never a dark overlay. */}
                    <div
                        className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
                        onClick={skip}
                    />

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={step.id}
                            variants={modalVariants}
                            initial="hidden"
                            animate="show"
                            exit="exit"
                            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                        >
                            {/* Accent header bar */}
                            <div className="h-1.5 w-full bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />

                            <div className="p-7">
                                {/* Progress meta */}
                                <div className="mb-4 flex items-center justify-between">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                                        Step {index + 1} of {total}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={skip}
                                        className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-600"
                                    >
                                        Skip
                                    </button>
                                </div>

                                {/* Progress track */}
                                <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                                    <motion.div
                                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
                                        initial={false}
                                        animate={{ width: `${((index + 1) / total) * 100}%` }}
                                        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                                    />
                                </div>

                                <motion.div variants={scaleIn} initial="hidden" animate="show">
                                    <h2
                                        id="first-run-title"
                                        className="text-xl font-bold text-slate-900"
                                    >
                                        {step.title}
                                    </h2>
                                </motion.div>

                                <motion.p
                                    variants={fadeInUp}
                                    initial="hidden"
                                    animate="show"
                                    className="mt-3 text-sm leading-relaxed text-slate-600"
                                >
                                    {step.body}
                                </motion.p>

                                {/* Controls */}
                                <div className="mt-7 flex items-center justify-between gap-3">
                                    <button
                                        type="button"
                                        onClick={back}
                                        disabled={isFirst}
                                        className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-0"
                                    >
                                        Back
                                    </button>

                                    <button
                                        type="button"
                                        onClick={next}
                                        className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-700 hover:to-indigo-700 hover:shadow"
                                    >
                                        {step.cta ?? (isLast ? 'Finish' : 'Next')}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </AnimatePresence>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export default FirstRunFlow;
