import { useRef, useState } from "react";
import { db, queueChange } from "../db";
import { markBackupExported } from "../lib/backupStatus";
import { getCurrentUserId } from "../lib/identity";
import { SYNC_TABLE_LABELS } from "../lib/sync";
import type { BackupFile, SyncTableName } from "../types";
import { Modal } from "./Modal";

const TABLES: SyncTableName[] = [
  "semesters",
  "classPeriods",
  "courses",
  "courseSchedules",
  "courseCancellations",
  "categories",
  "events",
  "eventOccurrenceStates",
  "anniversaries",
  "memoFolders",
  "memos",
  "focusSettings",
  "focusSessions"
];
const OPTIONAL_TABLES_IN_OLD_BACKUPS = new Set<SyncTableName>(["anniversaries"]);

interface BackupDialogProps {
  onClose: () => void;
}

interface BackupTablePreview {
  table_name: SyncTableName;
  label: string;
  incoming: number;
  existing: number;
  created: number;
  local_owner: number;
  other_owner: number;
}

interface BackupPreview {
  file_name: string;
  exported_at: string;
  total: number;
  backup: BackupFile;
  tables: BackupTablePreview[];
}

export function BackupDialog({ onClose }: BackupDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [importing, setImporting] = useState(false);

  async function createBackup(): Promise<BackupFile> {
    const data = {} as BackupFile["data"];
    for (const name of TABLES) {
      data[name] = await db.table(name).toArray();
    }
    return {
      format: "semester-schedule-backup",
      schema_version: 1,
      exported_at: new Date().toISOString(),
      data
    };
  }

  function downloadBackup(backup: BackupFile, fileName: string) {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    markBackupExported();
  }

  async function exportBackup() {
    downloadBackup(await createBackup(), `日程计划表备份-${new Date().toISOString().slice(0, 10)}.json`);
    setMessage("备份文件已导出。");
  }

  async function previewBackup(file?: File) {
    setMessage("");
    setPreview(null);
    if (!file) return;
    try {
      const parsed = validateBackup(JSON.parse(await file.text()));
      const currentUserId = getCurrentUserId();
      const tables: BackupTablePreview[] = [];

      for (const tableName of TABLES) {
        const records = parsed.data[tableName] as Array<Record<string, unknown>>;
        const ids = records.map((record) => String(record.id));
        const existingRecords = await db.table(tableName).bulkGet(ids);
        const existing = existingRecords.filter(Boolean).length;
        tables.push({
          table_name: tableName,
          label: SYNC_TABLE_LABELS[tableName] ?? tableName,
          incoming: records.length,
          existing,
          created: records.length - existing,
          local_owner: records.filter((record) => record.user_id === "local" && currentUserId !== "local").length,
          other_owner: records.filter((record) => record.user_id && record.user_id !== "local" && record.user_id !== currentUserId).length
        });
      }

      setPreview({
        file_name: file.name,
        exported_at: parsed.exported_at,
        total: tables.reduce((sum, table) => sum + table.incoming, 0),
        backup: parsed,
        tables
      });
      setMessage("已读取备份，请确认预览后再导入。");
    } catch (error) {
      setMessage(error instanceof Error ? `读取失败：${error.message}` : "读取失败");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function confirmImport() {
    if (!preview || importing) return;
    if (!window.confirm("确认导入这份备份？导入前会自动下载当前本地数据快照。")) return;
    setImporting(true);
    setMessage("");
    try {
      downloadBackup(await createBackup(), `导入前自动备份-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      const currentUserId = getCurrentUserId();

      await db.transaction("rw", [...TABLES.map((name) => db.table(name)), db.syncQueue], async () => {
        for (const tableName of TABLES) {
          const records = (preview.backup.data[tableName] as Array<Record<string, unknown>>).map((record) => {
            if (record.user_id === "local" && currentUserId !== "local") {
              return {
                ...record,
                user_id: currentUserId,
                version: Number(record.version ?? 0) + 1,
                updated_at: new Date().toISOString()
              };
            }
            return record;
          });
          await db.table(tableName).bulkPut(records);
          for (const record of records) {
            if (record.user_id === currentUserId || record.user_id === "local") {
              await queueChange(tableName, String(record.id));
            }
          }
        }
      });

      setMessage(`导入完成：合并 ${preview.total} 条记录；当前账号相关记录已加入同步队列。`);
      setPreview(null);
    } catch (error) {
      setMessage(error instanceof Error ? `导入失败：${error.message}` : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal title="数据备份" onClose={onClose}>
      <div className="backup-options">
        <section>
          <h3>导出 JSON</h3>
          <p>导出学期、节次、课程、事项、纪念日、备忘录、专注记录和停课记录。建议定期保存到安全位置。</p>
          <button className="button primary" onClick={() => void exportBackup()}>导出备份</button>
        </section>
        <section>
          <h3>导入 JSON</h3>
          <p>选择文件后会先预览，不会立即写入。确认导入前会自动下载一份当前本地快照。</p>
          <input ref={inputRef} className="file-input" type="file" accept="application/json,.json" onChange={(event) => void previewBackup(event.target.files?.[0])} />
        </section>

        {preview && (
          <section className="backup-preview">
            <div className="backup-preview-summary">
              <div>
                <strong>{preview.file_name}</strong>
                <span>导出时间：{new Date(preview.exported_at).toLocaleString("zh-CN")} · 共 {preview.total} 条</span>
              </div>
              <div className="inline-actions">
                <button className="button secondary compact" disabled={importing} onClick={() => setPreview(null)}>取消导入</button>
                <button className="button primary compact" disabled={importing} onClick={() => void confirmImport()}>{importing ? "导入中…" : "确认导入"}</button>
              </div>
            </div>
            <div className="backup-preview-table">
              {preview.tables.filter((table) => table.incoming > 0).map((table) => (
                <article key={table.table_name}>
                  <strong>{table.label}</strong>
                  <span>导入 {table.incoming} · 新增 {table.created} · 更新 {table.existing}</span>
                  {(table.local_owner > 0 || table.other_owner > 0) && (
                    <small>
                      {table.local_owner > 0 ? `本地匿名 ${table.local_owner} 条会归入当前账号。` : ""}
                      {table.other_owner > 0 ? `另有 ${table.other_owner} 条属于其他账号，导入后不会在当前账号视图显示。` : ""}
                    </small>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {message && <p className="status-message">{message}</p>}
      </div>
    </Modal>
  );
}

function validateBackup(value: unknown): BackupFile {
  const parsed = value as BackupFile;
  if (parsed.format !== "semester-schedule-backup" || parsed.schema_version !== 1 || !parsed.data) {
    throw new Error("不支持的备份格式");
  }
  if (!parsed.exported_at || Number.isNaN(new Date(parsed.exported_at).getTime())) {
    throw new Error("备份文件缺少有效导出时间");
  }
  for (const tableName of TABLES) {
    const rows = parsed.data[tableName];
    if (!Array.isArray(rows)) {
      if (OPTIONAL_TABLES_IN_OLD_BACKUPS.has(tableName)) {
        parsed.data[tableName] = [];
        continue;
      }
      throw new Error(`缺少数据表：${tableName}`);
    }
    for (const row of rows) {
      if (!row || typeof row !== "object" || typeof (row as { id?: unknown }).id !== "string") {
        throw new Error(`${tableName} 中存在无效记录`);
      }
    }
  }
  return parsed;
}
