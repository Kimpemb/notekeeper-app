// src/features/onboarding/useSampleNotes.ts
import { useEffect, useState } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useAppSettings } from "@/features/ui/store/useAppSettings";
import { SAMPLE_NOTES } from "./sampleNotes";
import { getSetting, setSetting } from "@/features/notes/db/queries";

export function useSampleNotes() {
  const notes = useNoteStore((s) => s.notes);
  const createNote = useNoteStore((s) => s.createNote);
  const settings = useAppSettings((s) => s.settings);
  const updateSetting = useAppSettings((s) => s.updateSetting);
  const settingsLoaded = useAppSettings((s) => s.loaded);
  const [hasStarted, setHasStarted] = useState(false);
  const [directFlag, setDirectFlag] = useState<boolean | null>(null);

  // Read directly from SQLite on mount to ensure we have the truth
  useEffect(() => {
    getSetting("hasInsertedSampleNotes").then((val) => {
      setDirectFlag(val === "true");
    });
  }, []);

  // Check if sample notes already exist by title
  const hasSampleNotes = notes.some(n => 
    n.title === SAMPLE_NOTES[0].title || 
    n.title === SAMPLE_NOTES[1].title ||
    n.title === SAMPLE_NOTES[2].title
  );

  // Sync flag if notes exist but flag is wrong
  useEffect(() => {
    if (settingsLoaded && hasSampleNotes && !settings.hasInsertedSampleNotes) {
      updateSetting("hasInsertedSampleNotes", true);
      setSetting("hasInsertedSampleNotes", "true").catch(console.error);
    }
  }, [settingsLoaded, hasSampleNotes, settings.hasInsertedSampleNotes, updateSetting]);

  // Main insertion logic
  useEffect(() => {
    const flag = directFlag !== null ? directFlag : settings.hasInsertedSampleNotes;

    const shouldRun =
      settingsLoaded &&
      !flag &&
      !hasSampleNotes &&
      !hasStarted &&
      notes.length > 0; // Wait for notes to load first

    if (!shouldRun) return;

    setHasStarted(true);

    const run = async () => {
      for (let i = 0; i < SAMPLE_NOTES.length; i++) {
        const sample = SAMPLE_NOTES[i];
        try {
          const result = await createNote({
            title: sample.title,
            content: JSON.stringify(sample.content),
            parent_id: null,
          });
        } catch (err) {
          console.error(`   ❌ Failed: ${sample.title}`, err);
        }
      }
      
    };

    run();
  }, [settingsLoaded, settings.hasInsertedSampleNotes, notes.length, hasSampleNotes, hasStarted, directFlag]);
}