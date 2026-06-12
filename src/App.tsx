/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from "react";
import { useState, useRef, useCallback, useEffect } from "react";
import { 
  Shield, 
  Trash2, 
  Download, 
  Check, 
  CheckCircle2,
  ChevronDown, 
  ChevronUp, 
  Upload, 
  ArrowRight, 
  Eye, 
  Lock, 
  FileCode, 
  Image as ImageIcon, 
  RefreshCw,
  Info,
  X,
  FileImage,
  Tag,
  Sparkles,
  ExternalLink,
  Plus,
  Minus,
  Layers,
  Sparkle,
  Copy,
  AlertCircle,
  FileArchive,
  Menu,
  CheckCircle,
  Clock,
  ExternalLink as LinkIcon
} from "lucide-react";
import { detectMetadata, stripMetadata, StripOptions, DetectedMetadata } from "./utils/metadataStripper";
import { RemoveTagLogo } from "./components/RemoveTagLogo";
import JSZip from "jszip";

interface CleanedFile {
  id: string;
  name: string;
  originalSize: number;
  cleanedSize: number;
  type: string;
  status: "idle" | "processing" | "success" | "error";
  imageUrl: string;
  cleanedUrl: string;
  savedBuffer: ArrayBuffer | null;
  options: {
    exif: boolean;
    xmp: boolean;
    c2pa: boolean;
    pngChunks: boolean;
  };
  detected: DetectedMetadata;
  isExpanded: boolean;
}

export default function App() {
  // Global defaults
  const [globalOptions, setGlobalOptions] = useState<StripOptions>({
    exif: true,
    xmp: true,
    c2pa: true,
    pngChunks: true,
  });

  // Main state
  const [files, setFiles] = useState<CleanedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [batchProgress, setBatchProgress] = useState<number | null>(null); // Progress bar range 0-100
  const [warning, setWarning] = useState<string | null>(null);
  
  // Drag and drop list reordering index state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  // FAQ Accordion states
  const [faqOpen, setFaqOpen] = useState<Record<number, boolean>>({
    0: true, // First index open by default
  });

  // Mobile menu toggle
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Completed download tracking state
  const [downloadCompleted, setDownloadCompleted] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scroll logic
  const scrollToElement = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
    setMobileMenuOpen(false);
  };

  // Format file size nicely
  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Global toggle helpers
  const toggleGlobalOption = (key: keyof StripOptions) => {
    setGlobalOptions((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      // Also sync it to all currently idle files for perfect feedback loop
      setFiles((currFiles) =>
        currFiles.map((f) => {
          if (f.status === "idle" || f.status === "processing") {
            const newOpts = { ...f.options, [key]: updated[key] };
            return { ...f, options: newOpts };
          }
          return f;
        })
      );
      return updated;
    });
  };

  // Indiv file toggle handler
  const toggleFileOption = (fileId: string, optionKey: keyof StripOptions) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id === fileId) {
          const newOpts = { ...f.options, [optionKey]: !f.options[optionKey] };
          // If already successfully processed, let's trigger single-file recalculation!
          const updatedFile = { ...f, options: newOpts, status: "idle" as const };
          recalculateSingleFile(updatedFile);
          return updatedFile;
        }
        return f;
      })
    );
  };

  // Local helper to re-strip an individual file on option toggled
  const recalculateSingleFile = async (item: CleanedFile) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === item.id ? { ...f, status: "processing" } : f))
    );

    try {
      if (!item.savedBuffer) {
        // Fetch raw representation again if we haven't stored original.
        // But since we operate browser memory, we did store or we can read it.
        // Let's make sure we find the ArrayBuffer from cached imageUrl or state.
        // Our App saves incoming buffers to do re-runs!
        // We'll read from item.imageUrl
        const response = await fetch(item.imageUrl);
        const originalBuf = await response.arrayBuffer();
        
        const cleanedBuffer = await stripMetadata(originalBuf, item.type, item.options);
        const cleanedBlob = new Blob([cleanedBuffer], { type: item.type });
        const cleanedUrl = URL.createObjectURL(cleanedBlob);

        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? {
                  ...f,
                  status: "success",
                  cleanedSize: cleanedBlob.size,
                  cleanedUrl: cleanedUrl,
                }
              : f
          )
        );
      } else {
        // We keep original raw array buffer inside cached fetch logic
        const response = await fetch(item.imageUrl);
        const originalBuf = await response.arrayBuffer();
        const cleanedBuffer = await stripMetadata(originalBuf, item.type, item.options);
        const cleanedBlob = new Blob([cleanedBuffer], { type: item.type });
        
        // Revoke former URL to prevent leak
        if (item.cleanedUrl) {
          URL.revokeObjectURL(item.cleanedUrl);
        }
        const cleanedUrl = URL.createObjectURL(cleanedBlob);

        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? {
                  ...f,
                  status: "success",
                  cleanedSize: cleanedBlob.size,
                  cleanedUrl: cleanedUrl,
                }
              : f
          )
        );
      }
    } catch (err) {
      console.error("Failed to recalculate metadata", err);
      setFiles((prev) =>
        prev.map((f) => (f.id === item.id ? { ...f, status: "error" } : f))
      );
    }
  };

  // Drag and drop list reordering
  const handleItemDragStart = (idx: number) => {
    setDraggedIdx(idx);
  };

  const handleItemDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
  };

  const handleItemDrop = (targetIdx: number) => {
    if (draggedIdx === null || draggedIdx === targetIdx) return;
    setFiles((prev) => {
      const copy = [...prev];
      const draggedItem = copy[draggedIdx];
      copy.splice(draggedIdx, 1);
      copy.splice(targetIdx, 0, draggedItem);
      return copy;
    });
    setDraggedIdx(null);
  };

  // Processes new files
  const processFiles = useCallback(async (incomingFiles: FileList | File[]) => {
    setWarning(null);
    
    // 1. Copy live FileList to a safe JS Array first before resetting the file input
    const filesArray = Array.from(incomingFiles || []);
    
    // 2. Clear input value AFTER copying to allow uploading same files consecutively
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    
    const incomingList = filesArray.filter(file => {
      if (!file) return false;
      const type = (file.type || "").toLowerCase();
      const ext = (file.name || "").split(".").pop()?.toLowerCase() || "";
      const isValid = type.startsWith("image/") || ["jpg", "jpeg", "png", "webp"].includes(ext);
      return isValid;
    });

    if (incomingList.length === 0) {
      setWarning("No support found for the uploaded file format. Please drop valid JPG, PNG or WEBP images.");
      return;
    }

    // Clip up to 20 files
    let listToProcess = incomingList;
    if (files.length + incomingList.length > 20) {
      setWarning("Batch limit reached. Only the first 20 files can be uploaded and processed together.");
      listToProcess = incomingList.slice(0, Math.max(0, 20 - files.length));
    }

    if (listToProcess.length === 0) return;

    // Create item placeholders
    const newItems: CleanedFile[] = [];
    setBatchProgress(10);

    for (const file of listToProcess) {
      try {
        // Read file array buffer immediately to run metadata detection
        const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
          reader.onerror = (err) => reject(err);
          reader.readAsArrayBuffer(file);
        });

        const fileType = file.type || (file.name.endsWith(".png") ? "image/png" : file.name.endsWith(".webp") ? "image/webp" : "image/jpeg");
        const detectedMetas = await detectMetadata(arrayBuffer, fileType);

        newItems.push({
          id: `${Date.now()}_${Math.random()}`,
          name: file.name,
          originalSize: file.size,
          cleanedSize: file.size,
          type: fileType,
          status: "idle",
          imageUrl: URL.createObjectURL(file),
          cleanedUrl: "",
          savedBuffer: arrayBuffer, // Keep original buffer to allow toggle changes instantly
          options: { ...globalOptions },
          detected: detectedMetas,
          isExpanded: false
        });
      } catch (err) {
        console.error("Error loading file in memory: ", err);
      }
    }

    // append new items to list
    setFiles((prev) => [...prev, ...newItems]);

    // Process each item individually
    let completedCount = 0;
    for (let i = 0; i < newItems.length; i++) {
      const item = newItems[i];
      setFiles((prev) =>
        prev.map((f) => (f.id === item.id ? { ...f, status: "processing" } : f))
      );

      try {
        // Simulated progress steps for beautiful CSS-only feeling
        await new Promise((r) => setTimeout(r, 450));

        const originalBuffer = item.savedBuffer!;
        const cleanedBuffer = await stripMetadata(originalBuffer, item.type, item.options);
        const cleanedBlob = new Blob([cleanedBuffer], { type: item.type });
        const cleanedUrl = URL.createObjectURL(cleanedBlob);

        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? {
                  ...f,
                  status: "success",
                  cleanedSize: cleanedBlob.size,
                  cleanedUrl: cleanedUrl,
                }
              : f
          )
        );
      } catch (err) {
        console.error(err);
        setFiles((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, status: "error" } : f))
        );
      }

      completedCount++;
      const currentProgress = Math.round(10 + (completedCount / newItems.length) * 90);
      setBatchProgress(currentProgress);
    }

    // Clear progress indicator after file sequence finishes 
    setTimeout(() => {
      setBatchProgress(null);
    }, 1000);

  }, [files, globalOptions]);

  // Drag and drop events to the zone
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  // Keyboard CTRLV Clipboard support
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        processFiles(e.clipboardData.files);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [processFiles]);

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.imageUrl);
        if (target.cleanedUrl) URL.revokeObjectURL(target.cleanedUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const clearAllFiles = () => {
    files.forEach((file) => {
      URL.revokeObjectURL(file.imageUrl);
      if (file.cleanedUrl) URL.revokeObjectURL(file.cleanedUrl);
    });
    setFiles([]);
    setBatchProgress(null);
    setWarning(null);
    setDownloadCompleted(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleStartOver = () => {
    clearAllFiles();
  };

  // Download a single cleaned file
  const downloadFile = (file: CleanedFile) => {
    const a = document.createElement("a");
    a.href = file.cleanedUrl || file.imageUrl;
    // format clear name 
    const pointIdx = file.name.lastIndexOf(".");
    const ext = pointIdx !== -1 ? file.name.substring(pointIdx) : "";
    const nameWithoutExt = pointIdx !== -1 ? file.name.substring(0, pointIdx) : file.name;
    a.download = `${nameWithoutExt}_cleaned${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Set individual download completes
    setDownloadCompleted(true);
  };

  // Multi compression ZIP download 
  const downloadAllAsZip = async () => {
    const zip = new JSZip();
    const successFiles = files.filter((f) => f.status === "success" && f.cleanedUrl);
    if (successFiles.length === 0) return;

    for (const file of successFiles) {
      try {
        const response = await fetch(file.cleanedUrl);
        const dataBlob = await response.blob();
        
        // append name variations cleanly
        const pointIdx = file.name.lastIndexOf(".");
        const ext = pointIdx !== -1 ? file.name.substring(pointIdx) : "";
        const basename = pointIdx !== -1 ? file.name.substring(0, pointIdx) : file.name;
        
        zip.file(`${basename}_cleaned${ext}`, dataBlob);
      } catch (err) {
        console.error("Failed to fetch cleaned image resource: ", file.name, err);
      }
    }

    try {
      const content = await zip.generateAsync({ type: "blob" });
      const mainUrl = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = mainUrl;
      a.download = `RemoveTag_clean_pack.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(mainUrl);
      
      // Set download completes
      setDownloadCompleted(true);
    } catch (err) {
      console.error("ZIP creation failed in browser memory: ", err);
    }
  };

  // Expand / minimize per-file inspector list 
  const toggleInspector = (id: string) => {
    setFiles((prev) =>
      prev.map((f) => f.id === id ? { ...f, isExpanded: !f.isExpanded } : f)
    );
  };

  const toggleFaq = (idx: number) => {
    setFaqOpen((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#0f172a] selection:bg-sky-200">
      
      {/* Dynamic Header */}
      <header className="sticky top-0 z-50 w-full h-16 bg-white/85 backdrop-blur-md border-b border-[#e0f2fe] flex items-center justify-between px-6 md:px-12 transition-all">
        <div 
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="flex items-center gap-2.5 cursor-pointer hover:scale-[1.01] active:scale-[0.99] transition-all"
          id="navbar-logo"
        >
          <RemoveTagLogo size="md" />
        </div>

        {/* Desktop Navbar Menu links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-[#64748b]">
          <button 
            onClick={() => scrollToElement("how-it-works")} 
            className="hover:text-[#0ea5e9] transition-colors h-11"
          >
            How it works
          </button>
          <button 
            onClick={() => scrollToElement("what-we-remove")} 
            className="hover:text-[#0ea5e9] transition-colors h-11"
          >
            Capabilities
          </button>
          <button 
            onClick={() => scrollToElement("showcase")} 
            className="hover:text-[#0ea5e9] transition-colors h-11"
          >
            Label Simulation
          </button>
          <button 
            onClick={() => scrollToElement("faq")} 
            className="hover:text-[#0ea5e9] transition-colors h-11"
          >
            FAQ
          </button>
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => scrollToElement("tool-pane")}
            className="hidden sm:inline-flex items-center justify-center h-10 px-5 rounded-full bg-[#e0f2fe] hover:bg-sky-100 text-[#0ea5e9] text-xs font-bold transition-all uppercase tracking-wide"
          >
            ⚡ Open Tool
          </button>
          <button 
            onClick={() => scrollToElement("tool-pane")} 
            className="inline-flex items-center justify-center h-10 px-5 rounded-full bg-[#0ea5e9] text-white text-xs font-bold hover:bg-[#0284c7] transition-all shadow-sm uppercase tracking-wide cursor-pointer"
            id="free-tool-btn"
          >
            Free Tool
          </button>
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-50 border border-slate-100"
            title="Toggle Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Mobile drawer menu */}
      {mobileMenuOpen && (
        <div className="md:hidden w-full bg-white border-b border-[#e0f2fe] flex flex-col gap-4 p-5 text-sm font-semibold text-[#64748b] bg-white/95 backdrop-blur-md animate-fade-in-up">
          <button onClick={() => scrollToElement("how-it-works")} className="text-left py-2 hover:text-[#0ea5e9]">
            How It Works
          </button>
          <button onClick={() => scrollToElement("what-we-remove")} className="text-left py-2 hover:text-[#0ea5e9]">
            What We Remove
          </button>
          <button onClick={() => scrollToElement("showcase")} className="text-left py-2 hover:text-[#0ea5e9]">
            Label Simulation
          </button>
          <button onClick={() => scrollToElement("faq")} className="text-left py-2 hover:text-[#0ea5e9]">
            FAQ
          </button>
        </div>
      )}

      {/* Hero Section Container with original linear background */}
      <section 
        className="w-full relative px-6 md:px-12 lg:px-24 py-16 sm:py-24 flex flex-col items-center text-center overflow-hidden"
        style={{ background: "linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 50%, #ffffff 100%)" }}
      >
        
        {/* Animated small badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#e0f2fe] text-[#0ea5e9] text-[11px] sm:text-xs font-extrabold tracking-wider uppercase mb-8 shadow-sm hover:scale-[1.02] transition-transform animate-fade-in-up">
          <span className="flex h-1.5 w-1.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#0ea5e9]"></span>
          </span>
          ✦ 100% Free · Browser-Only · No Upload to Server
        </div>

        {/* Hero title header */}
        <h1 className="font-display font-black text-4xl sm:text-6xl md:text-[64px] text-[#0f172a] leading-tight max-w-4xl tracking-tight mb-6 animate-fade-in-up-delay-1">
          Remove AI Labels <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#0ea5e9] to-[#7c3aed]">
            Before You Post
          </span>
        </h1>

        <p className="text-base sm:text-lg md:text-xl text-[#64748b] max-w-2xl leading-relaxed mb-12 px-2 animate-fade-in-up-delay-2">
          Strip C2PA, XMP & EXIF metadata instantly and locally. 
          Prevent platforms from force-tagging your original creations with AI warnings.
        </p>

        {/* MAIN METADATA TOOL PANEL */}
        <div 
          id="tool-pane" 
          className="w-full max-w-4xl bg-white border border-[#e0f2fe] rounded-2xl p-4 sm:p-8 shadow-luminous-lg text-left animate-fade-in-up-delay-3"
          style={{ boxShadow: "0 8px 32px rgba(14,165,233,0.10)" }}
        >
          {/* Main Drag-And-Drop Box */}
          <div
            id="dropzone"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`group relative border-2 border-dashed rounded-xl py-12 px-6 text-center transition-all cursor-pointer flex flex-col items-center justify-center ${
              isDragging
                ? "border-[#7c3aed] bg-[#f0f9ff] scale-[1.01]"
                : "border-[#7dd3fc] bg-[#f0f9ff] hover:border-[#0ea5e9] hover:bg-sky-50/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={handleFileInputChange}
            />

            {/* Float SVG animation icon */}
            <div className="w-16 h-16 rounded-full bg-white border border-[#e0f2fe] text-[#0ea5e9] flex items-center justify-center shadow-sm mb-4 animate-float">
              <Upload className="w-7 h-7" />
            </div>

            <h3 className="font-display font-extrabold text-lg text-[#0f172a] mb-2">
              Drag & drop images here
            </h3>
            
            <p className="text-xs sm:text-sm text-[#64748b] mb-6 max-w-md">
              Process secure local files in absolute safety. PNG, JPEG, WEBP are supported. Paste to import (Ctrl+V) also active.
            </p>

            <button
              id="browse-files-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="inline-flex items-center justify-center gap-2 px-6 h-11 min-h-[44px] rounded-full bg-[#0ea5e9] hover:bg-[#0284c7] text-white font-extrabold text-sm active:scale-95 transition-all shadow-md shadow-sky-500/15"
            >
              <FileImage className="w-4 h-4" />
              Browse Files
            </button>
          </div>

          {/* Warnings Disp */}
          {warning && (
            <div className="mt-4 p-4 rounded-xl border border-rose-100 bg-rose-50 text-rose-700 text-xs sm:text-sm font-semibold flex items-start gap-2.5">
              <AlertCircle className="w-4.5 h-4.5 text-rose-500 flex-shrink-0 mt-0.5" />
              <span>{warning}</span>
            </div>
          )}

          {/* Standard Global pill configurations */}
          <div className="mt-8 flex flex-col gap-4 border-t border-[#e0f2fe] pt-6">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-extrabold text-[#64748b] uppercase tracking-wider">
                Active Strip Parameters (Global Defaults)
              </h4>
             <span className="text-[10px] bg-sky-50 text-[#0ea5e9] px-2 py-0.5 rounded-full font-mono font-bold">
               Interactive
             </span>
            </div>

            <div className="flex flex-wrap gap-2.5">
              <button
                id="toggle-exif"
                onClick={() => toggleGlobalOption("exif")}
                className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                  globalOptions.exif
                    ? "bg-[#0ea5e9] text-white shadow-sm shadow-sky-500/10"
                    : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${globalOptions.exif ? "bg-white" : "bg-slate-300"}`} />
                EXIF Metadata {globalOptions.exif ? "Active" : "Stripped"}
              </button>

              <button
                id="toggle-xmp"
                onClick={() => toggleGlobalOption("xmp")}
                className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                  globalOptions.xmp
                    ? "bg-[#0ea5e9] text-white shadow-sm shadow-sky-500/10"
                    : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${globalOptions.xmp ? "bg-white" : "bg-slate-300"}`} />
                XMP Tags {globalOptions.xmp ? "Active" : "Stripped"}
              </button>

              <button
                id="toggle-c2pa"
                onClick={() => toggleGlobalOption("c2pa")}
                className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                  globalOptions.c2pa
                    ? "bg-[#0ea5e9] text-white shadow-sm shadow-sky-500/10"
                    : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${globalOptions.c2pa ? "bg-white" : "bg-slate-300"}`} />
                C2PA Credentials {globalOptions.c2pa ? "Active" : "Stripped"}
              </button>

              <button
                id="toggle-png-chunks"
                onClick={() => toggleGlobalOption("pngChunks")}
                className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                  globalOptions.pngChunks
                    ? "bg-[#0ea5e9] text-white shadow-sm shadow-sky-500/10"
                    : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${globalOptions.pngChunks ? "bg-white" : "bg-slate-300"}`} />
                PNG Chunks {globalOptions.pngChunks ? "Active" : "Stripped"}
              </button>
            </div>
          </div>

          {/* Batch Progress Bar Indicator */}
          {batchProgress !== null && (
            <div className="mt-8">
              <div className="flex items-center justify-between text-xs text-[#64748b] bg-slate-55 p-1 rounded font-bold mb-2">
                <span className="flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#0ea5e9]" />
                  Processing browser images...
                </span>
                <span>{batchProgress}%</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-[#0ea5e9] transition-all duration-300 rounded-full"
                  style={{ width: `${batchProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* File Upload Queue List */}
          {files.length > 0 && (
            <div className="mt-8 border-t border-[#e0f2fe] pt-8">
              {downloadCompleted && (
                <div 
                  id="success-start-over-banner"
                  className="mb-6 p-4 rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-800 text-xs sm:text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in-up"
                >
                  <div className="flex items-start gap-2.5">
                    <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-extrabold block text-slate-900">Success! Metadata Sanitized & Downloaded</span>
                      <span className="text-slate-600 text-xs">Your clean, label-safe copy is now saved. Ready for publication!</span>
                    </div>
                  </div>
                  <button
                    id="clear-start-over-btn"
                    onClick={handleStartOver}
                    className="min-h-[44px] justify-center inline-flex items-center gap-2 px-5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition-all tracking-wide uppercase shadow-sm shadow-emerald-500/20 active:scale-95 cursor-pointer flex-shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Clear & Start Over
                  </button>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h4 className="font-display font-extrabold text-base text-[#0f172a]">
                    Upload Queue ({files.length} {files.length === 1 ? "File" : "Files"})
                  </h4>
                  <p className="text-xs text-[#64748b]">
                    Tip: Drag items up and down to change order. Click to inspect, or toggle individual metadata parameters per file.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    id="clear-all-btn"
                    onClick={clearAllFiles}
                    className="min-h-[44px] flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 rounded-full border border-[#e0f2fe] hover:bg-slate-50 text-[#64748b] text-xs font-bold transition-all cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    Clear List
                  </button>

                  {downloadCompleted && (
                    <button
                      id="clear-start-over-queue-btn"
                      onClick={handleStartOver}
                      className="min-h-[44px] flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition-all cursor-pointer shadow-sm shadow-emerald-100"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Clear & Start Over
                    </button>
                  )}

                  <button
                    id="download-all-zip-btn"
                    onClick={downloadAllAsZip}
                    disabled={files.every(f => f.status !== "success")}
                    className="min-h-[44px] flex-2 sm:flex-none inline-flex items-center justify-center gap-2 px-5 rounded-full bg-[#0ea5e9] hover:bg-[#0284c7] disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none text-white text-xs font-bold transition-all shadow-md shadow-sky-500/15 cursor-pointer"
                  >
                    <FileArchive className="w-3.5 h-3.5" />
                    Download All as ZIP
                  </button>
                </div>
              </div>

              {/* Display List with Drag Reordering support */}
              <div className="flex flex-col gap-3">
                {files.map((file, idx) => {
                  const savedBytes = Math.max(0, file.originalSize - file.cleanedSize);
                  const savedPercent = file.originalSize > 0 ? Math.round((savedBytes / file.originalSize) * 100) : 0;
                  const hasMetaFound = file.detected.exif || file.detected.xmp || file.detected.c2pa || file.detected.pngChunks;

                  return (
                    <div
                      key={file.id}
                      draggable
                      onDragStart={() => handleItemDragStart(idx)}
                      onDragOver={(e) => handleItemDragOver(e, idx)}
                      onDrop={() => handleItemDrop(idx)}
                      className={`flex flex-col p-4 border rounded-xl transition-all cursor-grab active:cursor-grabbing ${
                        draggedIdx === idx 
                          ? "border-[#7c3aed] bg-violet-50/10 opacity-60" 
                          : "border-[#e0f2fe] bg-white hover:border-sky-300"
                      }`}
                    >
                      {/* File Main Row */}
                      <div className="flex items-center gap-3 sm:gap-4">
                        {/* Drag Handle UI Icon */}
                        <div className="flex flex-col gap-0.5 text-slate-300 hover:text-slate-500 transition-colors pr-1 cursor-grab">
                          <span className="block w-3 h-0.5 bg-current rounded-full" />
                          <span className="block w-3 h-0.5 bg-current rounded-full" />
                          <span className="block w-3 h-0.5 bg-current rounded-full" />
                        </div>

                        {/* Thumbnail image */}
                        <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-[#e0f2fe] bg-slate-50 flex-shrink-0">
                          <img
                            src={file.imageUrl}
                            alt="Media"
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                          {file.status === "success" && (
                            <div className="absolute inset-0 bg-emerald-500/10 flex items-center justify-center">
                              <CheckCircle2 className="w-5 h-5 text-emerald-500 bg-white rounded-full" />
                            </div>
                          )}
                        </div>

                        {/* File detail name */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-extrabold text-sm text-[#0f172a] truncate max-w-[140px] sm:max-w-xs block">
                              {file.name}
                            </span>
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-[#64748b] uppercase">
                              {file.name.split(".").pop() || "IMG"}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#64748b]">
                            <span>Original: <strong className="text-slate-800">{formatSize(file.originalSize)}</strong></span>
                            {file.status === "success" && (
                              <>
                                <span className="text-slate-300">•</span>
                                <span className="text-emerald-600 font-bold">
                                  Cleaned: {formatSize(file.cleanedSize)}
                                </span>
                                {savedPercent > 0 && (
                                  <>
                                    <span className="text-slate-300">•</span>
                                    <span className="bg-emerald-50 text-emerald-600 font-extrabold px-1.5 py-0.5 rounded text-[10px]">
                                      Stripped -{savedPercent}% (Headers removed)
                                    </span>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Actions block */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleInspector(file.id)}
                            className="min-h-[44px] hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[#64748b] text-xs font-semibold"
                            title="Inspect metadata details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>{file.isExpanded ? "Collapse" : "Inspect Tags"}</span>
                            {hasMetaFound ? (
                              <span className="w-2 h-2 rounded-full bg-amber-500" />
                            ) : null}
                          </button>

                          {file.status === "success" && (
                            <button
                              id={`download-single-btn-${idx}`}
                              onClick={() => downloadFile(file)}
                              className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#0ea5e9]/10 hover:bg-[#0ea5e9]/20 text-[#0ea5e9] text-xs font-extrabold active:scale-95 transition-all"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span className="hidden md:inline">Download</span>
                            </button>
                          )}

                          {file.status === "processing" && (
                            <div className="text-xs text-[#0ea5e9] font-bold flex items-center gap-1 bg-sky-50 px-2 py-1.5 rounded-lg">
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Cleaning...</span>
                            </div>
                          )}

                          <button
                            onClick={() => removeFile(file.id)}
                            className="min-h-[44px] w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                            title="Remove file"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Expandable inspector block content */}
                      {file.isExpanded && (
                        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col gap-4 bg-slate-50/50 p-3 rounded-lg">
                          
                          {/* Inner per-file toggles */}
                          <div>
                            <span className="text-[10px] font-extrabold uppercase text-[#64748b] tracking-wider block mb-2">
                              Surgical Stripping Options (This file)
                            </span>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <label className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2 text-xs font-semibold cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={file.options.exif}
                                  onChange={() => toggleFileOption(file.id, "exif")}
                                  className="rounded text-[#0ea5e9] focus:ring-[#0ea5e9]"
                                />
                                <span>EXIF Tags</span>
                              </label>

                              <label className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2 text-xs font-semibold cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={file.options.xmp}
                                  onChange={() => toggleFileOption(file.id, "xmp")}
                                  className="rounded text-[#0ea5e9] focus:ring-[#0ea5e9]"
                                />
                                <span>XMP Tags</span>
                              </label>

                              <label className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2 text-xs font-semibold cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={file.options.c2pa}
                                  onChange={() => toggleFileOption(file.id, "c2pa")}
                                  className="rounded text-[#0ea5e9] focus:ring-[#0ea5e9]"
                                />
                                <span>C2PA Specs</span>
                              </label>

                              <label className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2 text-xs font-semibold cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={file.options.pngChunks}
                                  onChange={() => toggleFileOption(file.id, "pngChunks")}
                                  className="rounded text-[#0ea5e9] focus:ring-[#0ea5e9]"
                                />
                                <span>PNG Chunks</span>
                              </label>
                            </div>
                          </div>

                          {/* Tag structure findings readout */}
                          <div>
                            <span className="text-[10px] font-extrabold uppercase text-[#64748b] tracking-wider block mb-2">
                              Metadata Elements Found in Stream Analysis
                            </span>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                              {file.detected.details.map((detail, idxDet) => (
                                <div key={idxDet} className="flex justify-between bg-white border border-slate-100 p-2 rounded-lg gap-2">
                                  <span className="text-[#64748b] font-medium">{detail.key}:</span>
                                  <span className="text-[#0f172a] font-bold text-right truncate max-w-[180px]" title={detail.val}>
                                    {detail.val}
                                  </span>
                                </div>
                              ))}
                            </div>

                            {/* Verification summary label */}
                            <div className="mt-2.5 flex items-start gap-1 text-[11px] text-slate-500 bg-amber-50 border border-amber-100 p-2.5 rounded-lg">
                              <Sparkle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                              <span>
                                {hasMetaFound 
                                  ? "Original tracking fields detected. Turning on the checkboxes will surgically remove these segments while keeping image quality pixel-perfect." 
                                  : "Your image metadata stream appears incredibly light or already clean. No active publisher credentials detected."}
                              </span>
                            </div>
                          </div>

                        </div>
                      )}

                      {/* Mobile Expand Trigger banner */}
                      <button
                        onClick={() => toggleInspector(file.id)}
                        className="sm:hidden mt-2 pt-2 border-t border-slate-100 text-center text-xs font-bold text-[#64748b] flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span>{file.isExpanded ? "Hide Metadata Headers" : "Show Metadata Headers"}</span>
                        {file.isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* BEFORE / AFTER DEMO SECTION - "Stop the AI Label. Instantly." */}
      <section id="showcase" className="w-full max-w-[1280px] mx-auto px-6 md:px-12 py-20 bg-white">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-[11px] sm:text-xs font-extrabold text-[#7c3aed] uppercase tracking-widest bg-violet-100 px-3 py-1 rounded-full mb-3 inline-block">
            Dynamic Privacy Simulation
          </span>
          <h2 className="font-display font-bold text-3xl sm:text-[40px] text-[#0f172a] leading-tight tracking-tight mb-4">
            Stop the AI Label. Instantly.
          </h2>
          <p className="text-base text-[#64748b] leading-relaxed">
            Platforms like Instagram and Meta automatically scan headers. If Adobe, Photoshop, or AI generator footprints exist, they override your intent and force an "AI Label". Stripping this metadata preserves your autonomy.
          </p>
        </div>

        {/* Side-by-Side Mockup UI */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] items-center gap-8 md:gap-12 justify-center max-w-5xl mx-auto">
          
          {/* Card BEFORE (Red Glow) */}
          <div className="flex flex-col gap-4 animate-red-glow p-3.5 rounded-3xl bg-white border border-rose-100">
            <div className="flex items-center gap-1.5 self-center bg-rose-50 border border-rose-100 text-rose-600 text-[10px] font-extrabold px-3 py-1 rounded-full uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
              Before (Force Meta Label)
            </div>

            {/* Post Feed simulation mockup card */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-white font-extrabold text-sm font-display shadow-inner">
                    AR
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="font-extrabold text-sm text-[#0f172a]">Alex_Creative26</span>
                      <span className="w-3.5 h-3.5 bg-sky-400 rounded-full flex items-center justify-center text-white text-[8px] font-bold">✓</span>
                    </div>
                    <span className="text-xs text-[#64748b] block">@ar_pixels</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                </div>
              </div>

              <p className="text-sm text-slate-800 mb-4 leading-relaxed font-sans">
                Finally finished my digital painting landscape! Rendered over 45 hours using classic airbrushes. The colors match perfectly! 🏔️✨
              </p>

              {/* Dynamic SVG graphic with warning overlay */}
              <div className="relative w-full aspect-video rounded-xl bg-gradient-to-tr from-sky-200 via-sky-300 to-[#7c3aed]/40 border border-sky-100 overflow-hidden flex flex-col items-center justify-center p-3 animate-pulse">
                {/* Custom Vector Art inside app */}
                <svg viewBox="0 0 400 200" className="w-[85%] h-full max-h-[140px] drop-shadow-xl select-none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="0" y="0" width="400" height="200" fill="#f0fbff" rx="10" />
                  <path d="M 0,200 L 150,110 L 220,165 L 400,60 L 400,200 Z" fill="#bae6fd" opacity="0.6" />
                  <path d="M 60,200 L 210,130 L 270,180 L 400,110 L 400,200 Z" fill="#93c5fd" opacity="0.8" />
                  
                  {/* Sun */}
                  <circle cx="280" cy="70" r="18" fill="#fbbf24" opacity="0.8" />
                  {/* Birds */}
                  <path d="M 120,40 Q 125,35 130,40 Q 135,35 140,40" stroke="#475569" strokeWidth="2" strokeLinecap="round" fill="none" />
                  <path d="M 160,48 Q 165,43 170,48 Q 175,43 180,48" stroke="#475569" strokeWidth="2" strokeLinecap="round" fill="none" />
                </svg>

                {/* Simulated C2PA APP11/APP1 metadata badge flag */}
                <div className="absolute top-2.5 right-2.5 bg-rose-600/95 text-white font-mono text-[9px] font-bold px-2.5 py-0.5 rounded uppercase tracking-wider backdrop-blur-sm shadow">
                  C2PA credentials embedded
                </div>
              </div>

              {/* AUTOMATIC META LABEL CONTAINER */}
              <div className="mt-4 p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center flex-shrink-0 animate-bounce">
                    <Sparkles className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <span className="block text-xs font-extrabold text-[#0f172a]">✦ Made with AI</span>
                    <span className="block text-[10px] text-[#64748b] leading-tight">
                      Meta detected Photoshop metadata. Label applied automatically to post.
                    </span>
                  </div>
                </div>
                <Info className="w-4 h-4 text-rose-400 cursor-help" />
              </div>
            </div>
          </div>

          {/* Intersecting Arrow Divider */}
          <div className="flex lg:flex-col items-center justify-center gap-2 py-4">
            <span className="text-xl sm:text-2xl text-[#0ea5e9] font-bold">→</span>
            <span className="text-xs font-mono font-bold text-[#64748b]">SCRUBBED</span>
          </div>

          {/* Card AFTER (Green Glow) */}
          <div className="flex flex-col gap-4 animate-green-glow p-3.5 rounded-3xl bg-white border border-emerald-100">
            <div className="flex items-center gap-1.5 self-center bg-emerald-50 border border-emerald-100 text-emerald-600 text-[10px] font-extrabold px-3 py-1 rounded-full uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
              After (Clean - No Label)
            </div>

            {/* Post Feed simulation mockup card */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-white font-extrabold text-sm font-display shadow-inner">
                    AR
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="font-extrabold text-sm text-[#0f172a]">Alex_Creative26</span>
                      <span className="w-3.5 h-3.5 bg-sky-400 rounded-full flex items-center justify-center text-white text-[8px] font-bold">✓</span>
                    </div>
                    <span className="text-xs text-[#64748b] block">@ar_pixels</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                </div>
              </div>

              <p className="text-sm text-slate-800 mb-4 leading-relaxed font-sans">
                Finally finished my digital painting landscape! Rendered over 45 hours using classic airbrushes. The colors match perfectly! 🏔️✨
              </p>

              {/* Dynamic SVG graphic with clean checklist banner */}
              <div className="relative w-full aspect-video rounded-xl bg-gradient-to-tr from-sky-200 via-sky-300 to-[#7c3aed]/40 border border-sky-100 overflow-hidden flex flex-col items-center justify-center p-3">
                <svg viewBox="0 0 400 200" className="w-[85%] h-full max-h-[140px] drop-shadow-xl select-none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="0" y="0" width="400" height="200" fill="#f0fbff" rx="10" />
                  <path d="M 0,200 L 150,110 L 220,165 L 400,60 L 400,200 Z" fill="#bae6fd" opacity="0.6" />
                  <path d="M 60,200 L 210,130 L 270,180 L 400,110 L 400,200 Z" fill="#93c5fd" opacity="0.8" />
                  
                  <circle cx="280" cy="70" r="18" fill="#fbbf24" opacity="0.8" />
                  <path d="M 120,40 Q 125,35 130,40 Q 135,35 140,40" stroke="#475569" strokeWidth="2" strokeLinecap="round" fill="none" />
                  <path d="M 160,48 Q 165,43 170,48 Q 175,43 180,48" stroke="#475569" strokeWidth="2" strokeLinecap="round" fill="none" />
                </svg>

                {/* Metadata removed flag */}
                <div className="absolute top-2.5 right-2.5 bg-emerald-500 text-white font-mono text-[9px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-sm">
                  <Check className="w-2.5 h-2.5" strokeWidth={3} /> Metadata Strip Complete
                </div>
              </div>

              {/* NO WARNING CONTAINER, completely clean footer design */}
              <div className="mt-4 p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
                    <CheckCircle className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <span className="block text-xs font-extrabold text-[#0f172a]">Pixel Headers Protected</span>
                    <span className="block text-[10px] text-[#64748b]">
                      Publish with confidence. Clean binary payload does not trigger warning flags.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* HOW IT WORKS SECTION (3 Steps) */}
      <section id="how-it-works" className="w-full bg-[#f0f9ff] py-20 px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="font-display font-bold text-3xl sm:text-[40px] text-[#0f172a] tracking-tight mb-4">
              How It Works
            </h2>
            <p className="text-base text-[#64748b]">
              Your files never leave your browser space. Safe, secure, instant local metadata stripping.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 max-w-5xl mx-auto relative">
            
            {/* Steps connectors */}
            <div className="hidden md:block absolute top-7 left-[15%] right-[15%] h-0.5 bg-sky-200 -z-1" />

            {/* Step 1 */}
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-full bg-white border-2 border-[#0ea5e9] text-[#0ea5e9] flex items-center justify-center font-display font-extrabold text-xl shadow-sm mb-4">
                1
              </div>
              <h3 className="font-display font-extrabold text-lg text-[#0f172a] mb-2">Upload your image</h3>
              <p className="text-sm text-[#64748b] leading-relaxed max-w-xs">
                Drag, drop, click to paste, or browse up to 20 files instantly in maximum security.
              </p>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-full bg-white border-2 border-[#0ea5e9] text-[#0ea5e9] flex items-center justify-center font-display font-extrabold text-xl shadow-sm mb-4">
                2
              </div>
              <h3 className="font-display font-extrabold text-lg text-[#0f172a] mb-2">Choose what to strip</h3>
              <p className="text-sm text-[#64748b] leading-relaxed max-w-xs">
                Toggle EXIF, XMP, C2PA, or PNG Chunks globally, or customize parameters per-file.
              </p>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-full bg-white border-2 border-[#0ea5e9] text-[#0ea5e9] flex items-center justify-center font-display font-extrabold text-xl shadow-sm mb-4">
                3
              </div>
              <h3 className="font-display font-extrabold text-lg text-[#0f172a] mb-2">Download clean file</h3>
              <p className="text-sm text-[#64748b] leading-relaxed max-w-xs">
                Save cleaned image directly to your disk, or package files bulk as an archive ZIP.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* WHAT WE REMOVE (4 cards) */}
      <section id="what-we-remove" className="w-full max-w-[1280px] mx-auto px-6 md:px-12 py-20 bg-white">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="font-display font-bold text-3xl sm:text-[40px] text-[#0f172a] tracking-tight mb-4">
            No More Hidden Fingerprints
          </h2>
          <p className="text-base text-[#64748b]">
            Every tracking tag, software watermark, and device metadata marker scrubbed instantly.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          
          {/* Tag 1 */}
          <div className="p-6 rounded-2xl border border-[#e0f2fe] bg-white shadow-luminous shadow-luminous-hover flex flex-col gap-4">
            <div className="w-11 h-11 rounded-xl bg-sky-50 text-[#0ea5e9] flex items-center justify-center font-mono font-bold text-sm">
              EXIF
            </div>
            <div>
              <h4 className="font-display font-extrabold text-base text-[#0f172a] mb-1">EXIF Data</h4>
              <p className="text-xs text-[#64748b] leading-relaxed">
                Device manufacturer parameters, GPS coordinate trails, lens models, shutter speeds, and timestamps.
              </p>
            </div>
          </div>

          {/* Tag 2 */}
          <div className="p-6 rounded-2xl border border-[#e0f2fe] bg-white shadow-luminous shadow-luminous-hover flex flex-col gap-4">
            <div className="w-11 h-11 rounded-xl bg-violet-50 text-[#7c3aed] flex items-center justify-center font-mono font-bold text-sm">
              XMP
            </div>
            <div>
              <h4 className="font-display font-extrabold text-base text-[#0f172a] mb-1">XMP XML Tags</h4>
              <p className="text-xs text-[#64748b] leading-relaxed">
                Adobe Photoshop session logs, Lightroom edit steps, application history lists, and publisher copyright schemas.
              </p>
            </div>
          </div>

          {/* Tag 3 */}
          <div className="p-6 rounded-2xl border border-[#e0f2fe] bg-white shadow-luminous shadow-luminous-hover flex flex-col gap-4">
            <div className="w-11 h-11 rounded-xl bg-sky-50 text-[#0ea5e9] flex items-center justify-center">
              <Lock className="w-5 h-5 text-[#0ea5e9]" />
            </div>
            <div>
              <h4 className="font-display font-extrabold text-base text-[#0f172a] mb-1">C2PA Signatures</h4>
              <p className="text-xs text-[#64748b] leading-relaxed">
                Embedded publisher Content Credentials and metadata seals which trigger "Made with AI" labels on social networks.
              </p>
            </div>
          </div>

          {/* Tag 4 */}
          <div className="p-6 rounded-2xl border border-[#e0f2fe] bg-white shadow-luminous shadow-luminous-hover flex flex-col gap-4">
            <div className="w-11 h-11 rounded-xl bg-violet-50 text-[#7c3aed] flex items-center justify-center">
              <Layers className="w-5 h-5 text-[#7c3aed]" />
            </div>
            <div>
              <h4 className="font-display font-extrabold text-base text-[#0f172a] mb-1">PNG Chunks</h4>
              <p className="text-xs text-[#64748b] leading-relaxed">
                Injected textual profiles (tEXt, iTXt, zTXt, tIME) that leak rendering pipelines or generation text prompts.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* FAQ SECTION (6 Questions) */}
      <section id="faq" className="w-full bg-[#f0f9ff] py-20 px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="font-display font-bold text-3xl sm:text-[40px] text-[#0f172a] tracking-tight mb-4">
              Frequently Asked Questions
            </h2>
            <p className="text-base text-[#64748b]">
              Everything you need to know about removing tags and privacy compliance.
            </p>
          </div>

          <div className="w-full max-w-3xl mx-auto flex flex-col gap-3">
            {[
              {
                q: "Is it really 100% free with no file limits?",
                a: "Absolutely! RemoveTag is a public privacy tool. We do not require registration, credit cards, or trial tokens. You can import up to 20 images at once as a cohesive batch inside browser memory."
              },
              {
                q: "Do you store or upload my images to any server?",
                a: "No. Images are processed entirely inside your local device's browser memory (RAM) via JavaScript WebAPIs. Original pixels never touch any external API, database, or tracking server."
              },
              {
                q: "How does this prevent the \"Made with AI\" badge on social posts?",
                a: "Social media companies automatically parse file markers like Adobe's C2PA APP11 byte structure on ingest. By surgically removing the identifier segment while keeping JPEG/PNG content intact, social filters detect only raw pixels and do not trigger default warnings."
              },
              {
                q: "Does stripping metadata degrade visual image quality?",
                a: "No! Visual arrays remain untouched. Only tiny non-pixel metadata blocks at the head of the file stream are discarded. The actual pixel stream, color tables, and dimensions remain perfectly preserved."
              },
              {
                q: "Can I choose which specific elements to drop per-file?",
                a: "Yes! Click 'Inspect Tags' on any file inside your list. You will see a structural breakdown of detected streams and check boxes allowing you to strip select categories (such as just EXIF or only C2PA) on a granular basis."
              },
              {
                q: "Is there clipboard paste or hotkey support?",
                a: "Yes! You can copy any screenshot or graphic to your clipboard and hit standard Ctrl+V (or Cmd+V) paste anywhere on the website. The tool will parse it instantly as an imported file raw stream."
              }
            ].map((faq, idx) => {
              const isOpen = !!faqOpen[idx];
              return (
                <div key={idx} className="bg-white border border-[#e0f2fe] rounded-xl overflow-hidden transition-shadow shadow-sm hover:shadow-md">
                  <button
                    onClick={() => toggleFaq(idx)}
                    className="w-full p-5 flex items-center justify-between text-left font-display font-bold text-base text-[#0f172a] hover:bg-slate-50 transition-colors cursor-pointer min-h-[44px]"
                  >
                    <span>{faq.q}</span>
                    <span className="w-7 h-7 rounded-full bg-[#f0f9ff] text-[#0ea5e9] flex items-center justify-center flex-shrink-0 ml-4">
                      {isOpen ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-5 pt-0 text-sm text-[#64748b] leading-relaxed border-t border-slate-50 font-sans">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="w-full border-t border-[#e0f2fe] bg-white py-12 px-6 sm:px-12 md:px-16">
        <div className="max-w-[1280px] mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          
          <div className="flex flex-col items-center md:items-start gap-2">
            <div className="flex items-center gap-2.5">
              <RemoveTagLogo size="sm" />
            </div>
            <p className="text-xs text-[#64748b] max-w-sm text-center md:text-left mt-1">
              Your files never leave your browser. Advanced client-side metadata sanitization for complete autonomy.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-6 text-xs text-[#64748b] font-semibold">
            <a href="#" onClick={(e) => { e.preventDefault(); alert("RemoveTag performs all operations locally. We do not store, view, or collection any personal info."); }} className="hover:text-[#0ea5e9] transition-colors min-h-[44px] inline-flex items-center">Privacy Policy</a>
            <a href="#" onClick={(e) => { e.preventDefault(); alert("RemoveTag is provided free-of-charge for creative privacy. All code executes on-device client side."); }} className="hover:text-[#0ea5e9] transition-colors min-h-[44px] inline-flex items-center">Terms of Service</a>
            <a href="#" onClick={(e) => { e.preventDefault(); alert("Contact us at support@removetag.invalid (placeholder) or via our browser repository."); }} className="hover:text-[#0ea5e9] transition-colors min-h-[44px] inline-flex items-center">Disclaimer & Support</a>
          </div>

          <div className="text-xs text-[#64748b] text-center md:text-right flex flex-col items-center md:items-end gap-1">
            <span>Built with ♥ by RemoveTag</span>
            <span className="text-[10px] font-mono font-medium text-slate-300">v1.2.0 · Local WASM/JS Sandbox</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
