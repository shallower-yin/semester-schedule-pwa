import { useRef, useState } from "react";
import { db } from "../db";
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
  "memoFolders",
  "memos",
  "focusSettings",
  "focusSessions"
];

interface BackupDialogProps {
  onClose: () => void;
}

export function BackupDialog({ onClose }: BackupDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");

  async function exportBackup() {
    const data = {} as BackupFile["data"];
    for (const name of TABLES) {
      data[name] = await db.table(name).toArray();
    }
    const backup: BackupFile = {
      format: "semester-schedule-backup",
      schema_version: 1,
      exported_at: new Date().toISOString(),
      data
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `学期日程备份-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("备份文件已导出。");
  }

  async function importBackup(file?: File) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as BackupFile;
      if (parsed.format !== "semester-schedule-backup" || parsed.schema_version !== 1 || !parsed.data) {
        throw new Error("不支持的备份格式");
      }
      for (const tableName of TABLES) {
        if (!Array.isArray(parsed.data[tableName])) throw new Error(`缺少数据表：${tableName}`);
      }
      await db.transaction("rw", TABLES.map((name) => db.table(name)), async () => {
        for (const tableName of TABLES) {
          await db.table(tableName).bulkPut(parsed.data[tableName]);
        }
      });
      setMessage("导入完成，已有相同 ID 的记录已更新。");
    } catch (error) {
      setMessage(error instanceof Error ? `导入失败：${error.message}` : "导入失败");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Modal title="数据备份" onClose={onClose}>
      <div className="backup-options">
        <section>
          <h3>导出 JSON</h3>
          <p>导出学期、节次、课程、事项、备忘录、专注记录和停课记录。建议定期保存到安全位置。</p>
          <button className="button primary" onClick={exportBackup}>导出备份</button>
        </section>
        <section>
          <h3>导入 JSON</h3>
          <p>按记录 ID 合并数据，不会先清空当前内容。仅导入本工具生成的备份。</p>
          <input ref={inputRef} className="file-input" type="file" accept="application/json,.json" onChange={(event) => importBackup(event.target.files?.[0])} />
        </section>
        {message && <p className="status-message">{message}</p>}
      </div>
    </Modal>
  );
}
