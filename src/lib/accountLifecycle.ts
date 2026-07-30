import { db } from "../db";
import { clearAllAiTasks } from "./aiBackgroundTasks";
import { BACKUP_TABLES } from "./backup";
import { supabase } from "./supabase";

export async function deleteCurrentCloudAccount(): Promise<void> {
  if (!supabase) throw new Error("云端服务未配置，无法注销账号。");
  const { data, error } = await supabase.functions.invoke("admin", {
    body: { action: "delete-my-account" }
  });
  if (error) throw new Error(error.message || "注销账号失败。");
  if (data?.error) throw new Error(String(data.error));
  if (!data?.deleted) throw new Error("服务器未确认账号注销结果，请稍后重试。");
}

export async function clearLocalAccountData(ownerId: string): Promise<void> {
  clearAllAiTasks();
  const dataTables = BACKUP_TABLES.map((tableName) => db.table(tableName));
  await db.transaction(
    "rw",
    [...dataTables, db.syncQueue, db.localBackupSnapshots, db.aiAttachmentContexts],
    async () => {
      for (const table of dataTables) {
        const ids = await table.filter((record) => record.user_id === ownerId).primaryKeys();
        if (ids.length) await table.bulkDelete(ids);
      }
      await db.syncQueue.where("owner_id").equals(ownerId).delete();
      await db.localBackupSnapshots.where("owner_id").equals(ownerId).delete();
      await db.aiAttachmentContexts.where("ownerId").equals(ownerId).delete();
    }
  );

  const ownedSuffix = `:${ownerId}`;
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (key.endsWith(ownedSuffix) || key === `semester-schedule-last-sync:${ownerId}`) {
      localStorage.removeItem(key);
    }
  }
}
