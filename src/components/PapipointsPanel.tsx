import { useMemo, useState, type FormEvent } from "react";
import type { AppUserDefinition } from "../config/appUsers";
import type {
  PapipointsProfile,
  PapipointsReward,
  PapipointsTransaction,
} from "../models/gamification";
import { getLevelFromPapipoints, MAX_LEVEL } from "../utils/papipoints";
import type { RedeemResult } from "../hooks/usePapipoints";

interface PapipointsPanelProps {
  currentUser: AppUserDefinition;
  profiles: Record<"Yisel" | "Yorki", PapipointsProfile>;
  rewards: PapipointsReward[];
  transactions: PapipointsTransaction[];
  onSaveReward: (reward: PapipointsReward) => Promise<void>;
  onDeleteReward: (rewardId: string) => Promise<void>;
  onRedeemReward: (reward: PapipointsReward) => Promise<RedeemResult>;
  onMessage: (message: string) => void;
}

const transactionTypeLabels: Record<PapipointsTransaction["type"], string> = {
  task_created: "Tarea creada",
  task_completed: "Tarea completada",
  task_early: "Completada antes de tiempo",
  task_overdue: "Tarea vencida",
  reward_redeemed: "Recompensa canjeada",
};

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("es-DO", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const emptyRewardForm = {
  name: "",
  description: "",
  cost: "50",
  active: true,
};

export function LevelProgress({ profile }: { profile: PapipointsProfile }) {
  const maximum = profile.level >= MAX_LEVEL;
  const currentLevelProgress = Math.max(0, profile.balance - profile.currentLevelStart);
  const currentLevelRequirement = Math.max(1, profile.nextLevelTarget - profile.currentLevelStart);
  return (
    <article className="level-card">
      <div className="level-card-heading">
        <div>
          <span>{profile.userName}</span>
          <strong>NIVEL {profile.level}</strong>
        </div>
        <b>{profile.balance.toLocaleString("es-DO")} Papipuntos</b>
      </div>
      <div
        className="level-progress"
        role="progressbar"
        aria-label={`Progreso de nivel de ${profile.userName}`}
        aria-valuemin={0}
        aria-valuemax={maximum ? 1 : currentLevelRequirement}
        aria-valuenow={maximum ? 1 : currentLevelProgress}
      >
        <span style={{ width: `${profile.progressPercent}%` }} />
      </div>
      <small>
        {maximum
          ? "NIVEL MÁXIMO"
          : `${currentLevelProgress.toLocaleString("es-DO")} / ${currentLevelRequirement.toLocaleString("es-DO")} Papipuntos para este nivel`}
      </small>
    </article>
  );
}

export function PapipointsPanel({
  currentUser,
  profiles,
  rewards,
  transactions,
  onSaveReward,
  onDeleteReward,
  onRedeemReward,
  onMessage,
}: PapipointsPanelProps) {
  const [editingReward, setEditingReward] = useState<PapipointsReward | null>(null);
  const [form, setForm] = useState(emptyRewardForm);
  const [saving, setSaving] = useState(false);

  const currentProfile = profiles[currentUser.name];
  const userTransactions = useMemo(
    () =>
      transactions
        .filter((item) => item.userId === currentUser.uid && item.amount !== 0)
        .slice(0, 50),
    [currentUser.uid, transactions],
  );

  const resetForm = () => {
    setEditingReward(null);
    setForm(emptyRewardForm);
  };

  const editReward = (reward: PapipointsReward) => {
    setEditingReward(reward);
    setForm({
      name: reward.name,
      description: reward.description,
      cost: String(reward.cost),
      active: reward.active,
    });
  };

  const saveReward = async (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    const cost = Math.max(1, Number(form.cost) || 0);
    if (!name || !cost) return;

    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      await onSaveReward({
        id: editingReward?.id || crypto.randomUUID(),
        name,
        description: form.description.trim(),
        cost,
        active: form.active,
        createdAt: editingReward?.createdAt || timestamp,
        updatedAt: timestamp,
        createdByUserId: editingReward?.createdByUserId || currentUser.uid,
      });
      onMessage(editingReward ? "Recompensa actualizada." : "Recompensa creada.");
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const redeem = async (reward: PapipointsReward) => {
    const nextLevel = getLevelFromPapipoints(currentProfile.balance - reward.cost);
    const levelText =
      nextLevel < currentProfile.level
        ? ` Tu nivel bajará de ${currentProfile.level} a ${nextLevel}.`
        : "";
    if (
      !window.confirm(
        `¿Canjear “${reward.name}” por ${reward.cost} Papipuntos?${levelText}`,
      )
    ) {
      return;
    }

    const result = await onRedeemReward(reward);
    onMessage(result.message);
  };

  const removeReward = async (reward: PapipointsReward) => {
    if (!window.confirm(`¿Eliminar la recompensa “${reward.name}”?`)) return;
    await onDeleteReward(reward.id);
    if (editingReward?.id === reward.id) resetForm();
    onMessage("Recompensa eliminada.");
  };

  return (
    <section className="papipoints-page">
      <div className="manage-heading">
        <div>
          <span className="eyebrow">Progreso y recompensas</span>
          <h1>Papipuntos</h1>
          <p>Completa tareas, sube de nivel y canjea recompensas.</p>
        </div>
      </div>

      <div className="level-grid">
        <LevelProgress profile={profiles.Yorki} />
        <LevelProgress profile={profiles.Yisel} />
      </div>

      <div className="papipoints-layout">
        <section className="task-list-panel reward-catalog-panel">
          <div className="list-heading">
            <div>
              <h2>Recompensas disponibles</h2>
              <small>Tu saldo: {currentProfile.balance} Papipuntos</small>
            </div>
            <span>{rewards.filter((reward) => reward.active).length}</span>
          </div>

          <div className="reward-list">
            {rewards.map((reward) => (
              <article className={`reward-card ${!reward.active ? "reward-inactive" : ""}`} key={reward.id}>
                <div>
                  <strong>{reward.name}</strong>
                  {reward.description && <p>{reward.description}</p>}
                  {!reward.active && <small>No disponible</small>}
                </div>
                <b>{reward.cost} Papipuntos</b>
                <div className="reward-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={!reward.active || currentProfile.balance < reward.cost}
                    onClick={() => void redeem(reward)}
                  >
                    Canjear
                  </button>
                  <button className="button button-quiet" type="button" onClick={() => editReward(reward)}>
                    Editar
                  </button>
                  <button className="button button-quiet danger-action" type="button" onClick={() => void removeReward(reward)}>
                    Eliminar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <form className="task-list-panel reward-form" onSubmit={saveReward}>
          <div className="list-heading">
            <h2>{editingReward ? "Editar recompensa" : "Nueva recompensa"}</h2>
          </div>
          <label className="field">
            <span>Nombre</span>
            <input
              required
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Ej.: Elegir la cena"
            />
          </label>
          <label className="field">
            <span>Descripción</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Costo en Papipuntos</span>
            <input
              min="1"
              required
              type="number"
              inputMode="numeric"
              value={form.cost}
              onChange={(event) => setForm((current) => ({ ...current, cost: event.target.value }))}
            />
          </label>
          <label className="reward-active-field">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
            />
            <span>Recompensa activa</span>
          </label>
          <div className="form-actions">
            {editingReward && (
              <button className="button button-secondary" type="button" onClick={resetForm}>
                Cancelar
              </button>
            )}
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Guardando…" : editingReward ? "Guardar cambios" : "Crear recompensa"}
            </button>
          </div>
        </form>
      </div>

      <section className="task-list-panel papipoints-history">
        <div className="list-heading">
          <div>
            <h2>Historial de {currentUser.name}</h2>
            <small>Los últimos 50 movimientos de Papipuntos.</small>
          </div>
          <span>{userTransactions.length}</span>
        </div>
        {userTransactions.length ? (
          <div className="transaction-list">
            {userTransactions.map((transaction) => (
              <article className="transaction-row" key={transaction.id}>
                <span className={transaction.amount >= 0 ? "transaction-positive" : "transaction-negative"}>
                  {transaction.amount >= 0 ? "+" : ""}{transaction.amount}
                </span>
                <div>
                  <strong>{transactionTypeLabels[transaction.type]}</strong>
                  <small>{transaction.description} · {formatDate(transaction.createdAt)}</small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="list-empty">Todavía no hay movimientos de Papipuntos.</p>
        )}
      </section>
    </section>
  );
}
