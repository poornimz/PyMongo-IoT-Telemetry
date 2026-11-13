import React, { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import type { PipelineConfig } from '../utils/iotEngine';
import {
  REQUIREMENTS_TXT,
  buildPipelineSpec,
  buildPythonScript,
} from '../data/pythonSource';

interface PythonScriptPanelProps {
  config: PipelineConfig;
  activeTab: 'python' | 'pipeline';
  onTabChange: (tab: 'python' | 'pipeline') => void;
}

export function triggerTextDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const PythonScriptPanel: React.FC<PythonScriptPanelProps> = ({
  config,
  activeTab,
  onTabChange,
}) => {
  const [copied, setCopied] = useState(false);

  const pythonCode = useMemo(() => buildPythonScript(config), [config]);
  const pipelineJson = useMemo(
    () => JSON.stringify(buildPipelineSpec(config), null, 2),
    [config],
  );

  const currentContent = activeTab === 'python' ? pythonCode : pipelineJson;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const cliCommand = `MONGO_URI="mongodb://localhost:27017" python3 iot_telemetry_pipeline.py --avg-threshold ${config.avgThreshold.toFixed(1)} --peak-threshold ${config.peakThreshold.toFixed(1)} --batch-size ${config.batchSize}`;

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            PyMongo Implementation &amp; Aggregation Spec
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Synchronized with current threshold parameters
            <span aria-hidden="true" className="mx-1.5">·</span>
            pymongo &gt;= 4.6.0
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => onTabChange('python')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'python'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              iot_telemetry_pipeline.py
            </button>
            <button
              type="button"
              onClick={() => onTabChange('pipeline')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'pipeline'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Aggregation Pipeline JSON
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>

          <button
            type="button"
            onClick={() => triggerTextDownload('requirements.txt', REQUIREMENTS_TXT)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            requirements.txt
          </button>

          <button
            type="button"
            onClick={() => triggerTextDownload('iot_telemetry_pipeline.py', pythonCode)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Download .py
          </button>
        </div>
      </div>

      {/* CLI Quickstart Banner */}
      <div className="mt-4 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-md flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            CLI Execution
          </span>
          <code className="text-xs font-mono text-slate-800 break-all">
            pip install -r requirements.txt &amp;&amp; {cliCommand}
          </code>
        </div>
      </div>

      {/* Code Viewport */}
      <div className="mt-4 border border-slate-200 rounded-md bg-slate-950 text-slate-100 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 text-xs font-mono text-slate-400">
          <span>
            {activeTab === 'python'
              ? 'iot_telemetry_pipeline.py'
              : 'mongodb_hourly_aggregation_pipeline.json'}
          </span>
          <span>{currentContent.split('\n').length} lines</span>
        </div>
        <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto max-h-[460px] overflow-y-auto tabular-nums">
          <code>{currentContent}</code>
        </pre>
      </div>
    </section>
  );
};
