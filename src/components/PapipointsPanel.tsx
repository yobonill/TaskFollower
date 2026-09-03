import { useMemo, useState, type FormEvent } from "react";
import { getAppUserByUid, getOtherAppUser, type AppUserDefinition } from "../config/appUsers";
import type {
  PapipointsProfile,
  PapipointsReward,
  PapipointsRewardClaim,
  PapipointsTransaction,
} from "../models/gamification";
import {
  COMPLETION_POINTS,
  EARLY_COMPLETION_BONUS,
  getLevelFromPapipoints,
  MAX_LEVEL,
  OVERDUE_PENALTY,
  PENALTY_TASK_GRACE_MINUTES,
  PENALTY_TASK_POINTS_PER_HOUR,
  TASK_CREATION_POINTS,
} from "../utils/papipoints";
import type { RedeemResult } from "../hooks/usePapipoints";

interface PapipointsPanelProps {
  currentUser: AppUserDefinition;
  profiles: Record<"Yisel" | "Yorki", PapipointsProfile>;
  rewards: PapipointsReward[];
  rewardClaims: PapipointsRewardClaim[];
  transactions: PapipointsTransaction[];
  onSaveReward: (reward: PapipointsReward) => Promise<void>;
  onConfigureReward: (rewardId: string, cost: number, fulfillmentDays: number) => Promise<void>;
  onRejectReward: (rewardId: string) => Promise<void>;
  onDeleteReward: (rewardId: string) => Promise<void>;
  onRedeemReward: (reward: PapipointsReward, purchaseComment?: string) => Promise<RedeemResult>;
  onCompleteRewardClaim: (claim: PapipointsRewardClaim) => Promise<RedeemResult>;
  onCancelRewardClaim: (claim: PapipointsRewardClaim) => Promise<RedeemResult>;
  onMessage: (message: string) => void;
}

const transactionTypeLabels: Record<PapipointsTransaction["type"], string> = {
  task_created: "Tarea creada",
  task_completed: "Tarea completada",
  task_early: "Completada antes de tiempo",
  task_overdue: "Tarea vencida",
  penalty_task_hourly: "Penalización por hora",
  reward_redeemed: "Recompensa canjeada",
  reward_refund: "Reembolso de recompensa",
  reward_overdue_transfer: "Recompensa vencida",
};

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("es-DO", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const formatDueDate = (value: string): string => {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-DO", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(year, month - 1, day));
};

const emptyRewardForm = {
  name: "",
  description: "",
};

const priorityRuleRows = [
  { key: "low" as const, label: "Baja" },
  { key: "normal" as const, label: "Normal" },
  { key: "high" as const, label: "Alta" },
  { key: "critical" as const, label: "Crítica" },
];

function RewardPricingGuide({ cost }: { cost: number }) {
  const safeCost = Math.max(1, Math.floor(cost || 1));
  const normalTasks = Math.ceil(safeCost / COMPLETION_POINTS.normal);
  const overdueTransfer = Math.max(1, Math.ceil(safeCost * 0.1));

  return (
    <div className="reward-pricing-guide">
      <strong>{safeCost} PP ≈ {normalTasks} {normalTasks === 1 ? "tarea normal" : "tareas normales"}</strong>
      <div className="reward-equivalence-grid">
        {priorityRuleRows.map(({ key, label }) => (
          <span key={key}>
            {label}: ≈ {Math.ceil(safeCost / COMPLETION_POINTS[key])}
          </span>
        ))}
      </div>
      <small>
        Si la recompensa se vence, transferirá <b>{overdueTransfer} PP por día</b> del proveedor al solicitante, incluso si su saldo queda en negativo.
      </small>
    </div>
  );
}

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
  rewardClaims,
  transactions,
  onSaveReward,
  onConfigureReward,
  onRejectReward,
  onDeleteReward,
  onRedeemReward,
  onCompleteRewardClaim,
  onCancelRewardClaim,
  onMessage,
}: PapipointsPanelProps) {
  const [editingReward, setEditingReward] = useState<PapipointsReward | null>(null);
  const [form, setForm] = useState(emptyRewardForm);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [configCost, setConfigCost] = useState("100");
  const [configDays, setConfigDays] = useState("2");
  const [saving, setSaving] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [redeemingReward, setRedeemingReward] = useState<PapipointsReward | null>(null);
  const [redeemComment, setRedeemComment] = useState("");
  const [showRules, setShowRules] = useState(false);

  const currentProfile = profiles[currentUser.name];
  const partner = getOtherAppUser(currentUser.name);

  const myRewards = useMemo(
    () => rewards.filter((reward) => reward.requestedByUserId === currentUser.uid),
    [currentUser.uid, rewards],
  );
  const pendingForMe = useMemo(
    () =>
      rewards.filter(
        (reward) =>
          reward.providerUserId === currentUser.uid &&
          reward.status === "pending_configuration",
      ),
    [currentUser.uid, rewards],
  );
  const configuredByMe = useMemo(
    () =>
      rewards.filter(
        (reward) => reward.providerUserId === currentUser.uid && reward.status === "available",
      ),
    [currentUser.uid, rewards],
  );
  const availableForMe = useMemo(
    () => myRewards.filter((reward) => reward.status === "available" && reward.active),
    [myRewards],
  );
  const activeClaimRewardIds = useMemo(
    () => new Set(
      rewardClaims
        .filter((claim) => claim.requesterUserId === currentUser.uid && claim.status === "pending")
        .map((claim) => claim.rewardId),
    ),
    [currentUser.uid, rewardClaims],
  );
  const myClaims = useMemo(
    () =>
      rewardClaims.filter(
        (claim) =>
          claim.requesterUserId === currentUser.uid || claim.providerUserId === currentUser.uid,
      ),
    [currentUser.uid, rewardClaims],
  );
  const activeClaims = useMemo(
    () => myClaims.filter((claim) => claim.status === "pending"),
    [myClaims],
  );
  const claimHistory = useMemo(
    () => myClaims.filter((claim) => claim.status !== "pending").slice(0, 20),
    [myClaims],
  );
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
    if (reward.requestedByUserId !== currentUser.uid) return;
    setEditingReward(reward);
    setForm({ name: reward.name, description: reward.description });
  };

  const saveReward = async (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;

    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      const isEditingConfigured = editingReward?.status === "available";
      await onSaveReward({
        id: editingReward?.id || crypto.randomUUID(),
        name,
        description: form.description.trim(),
        requestedByUserId: editingReward?.requestedByUserId || currentUser.uid,
        providerUserId: editingReward?.providerUserId || partner.uid,
        status: isEditingConfigured
          ? "pending_configuration"
          : editingReward?.status === "rejected"
            ? "pending_configuration"
            : editingReward?.status || "pending_configuration",
        cost: isEditingConfigured ? undefined : editingReward?.cost,
        fulfillmentDays: isEditingConfigured ? undefined : editingReward?.fulfillmentDays,
        active: false,
        createdAt: editingReward?.createdAt || timestamp,
        updatedAt: timestamp,
        createdByUserId: editingReward?.createdByUserId || currentUser.uid,
        configuredAt: isEditingConfigured ? undefined : editingReward?.configuredAt,
        configuredByUserId: isEditingConfigured ? undefined : editingReward?.configuredByUserId,
        rejectedAt: undefined,
        rejectedByUserId: undefined,
      });
      onMessage(
        editingReward
          ? "Recompensa actualizada. Tu pareja debe definir nuevamente su costo y tiempo de entrega."
          : `Recompensa solicitada. ${partner.name} debe definir el costo y el tiempo para entregarla.`,
      );
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const startConfigure = (reward: PapipointsReward) => {
    setConfiguringId(reward.id);
    setConfigCost(String(reward.cost || 100));
    setConfigDays(String(reward.fulfillmentDays || 2));
  };

  const configure = async (reward: PapipointsReward) => {
    const cost = Math.max(1, Math.floor(Number(configCost) || 0));
    const days = Math.max(1, Math.floor(Number(configDays) || 0));
    if (!cost || !days) return;

    const overdueTransfer = Math.max(1, Math.ceil(cost * 0.1));
    const normalTaskEquivalent = Math.ceil(cost / COMPLETION_POINTS.normal);
    if (
      !window.confirm(
        `Configurar recompensa “${reward.name}”\n\nCosto: ${cost} Papipuntos\nTiempo para entregarla: ${days} ${days === 1 ? "día" : "días"}\nEquivale aproximadamente a ${normalTaskEquivalent} ${normalTaskEquivalent === 1 ? "tarea normal" : "tareas normales"}.\nSi se vence: ${overdueTransfer} Papipuntos transferidos por cada día de atraso. El saldo del proveedor puede quedar en negativo.\n\n¿Guardar estas condiciones?`,
      )
    ) {
      return;
    }

    await onConfigureReward(reward.id, cost, days);
    setConfiguringId(null);
    onMessage(`Recompensa configurada: ${cost} Papipuntos y ${days} ${days === 1 ? "día" : "días"} para entregarla.`);
  };

  const openRedeemDialog = (reward: PapipointsReward) => {
    setRedeemingReward(reward);
    setRedeemComment("");
  };

  const closeRedeemDialog = () => {
    if (redeemingReward && processingId === redeemingReward.id) return;
    setRedeemingReward(null);
    setRedeemComment("");
  };

  const redeem = async () => {
    const reward = redeemingReward;
    if (!reward) return;
    setProcessingId(reward.id);
    try {
      const result = await onRedeemReward(reward, redeemComment);
      onMessage(result.message);
      if (result.ok) {
        setRedeemingReward(null);
        setRedeemComment("");
      }
    } finally {
      setProcessingId(null);
    }
  };

  const removeReward = async (reward: PapipointsReward) => {
    if (reward.requestedByUserId !== currentUser.uid) return;
    if (!window.confirm(`Eliminar “${reward.name}” quitará la recompensa del catálogo. Los canjes que ya estén activos no se eliminarán.\n\n¿Continuar?`)) return;
    await onDeleteReward(reward.id);
    if (editingReward?.id === reward.id) resetForm();
    onMessage("Recompensa eliminada.");
  };

  const completeClaim = async (claim: PapipointsRewardClaim) => {
    if (!window.confirm(`Confirmar entrega de “${claim.rewardName}”.\n\nAl completarla se detendrán las penalizaciones diarias por atraso.`)) return;
    setProcessingId(claim.id);
    try {
      const result = await onCompleteRewardClaim(claim);
      onMessage(result.message);
    } finally {
      setProcessingId(null);
    }
  };

  const cancelClaim = async (claim: PapipointsRewardClaim) => {
    const refund = Math.floor(claim.cost * 0.7);
    const lost = claim.cost - refund;
    if (!window.confirm(
      `Cancelar recompensa\n\nPagaste ${claim.cost} Papipuntos. Recuperarás solamente el 70% (${refund} Papipuntos) y perderás ${lost} Papipuntos.\n\nLas compensaciones por atraso que ya se hayan transferido no se devolverán.\n\n¿Cancelar la recompensa?`,
    )) return;
    setProcessingId(claim.id);
    try {
      const result = await onCancelRewardClaim(claim);
      onMessage(result.message);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <section className="papipoints-page">
      <div className="manage-heading">
        <div>
          <span className="eyebrow">Progreso y recompensas</span>
          <h1>Papipuntos</h1>
          <p>Tú propones la recompensa; tu pareja decide cuánto cuesta y cuánto tiempo tendrá para entregarla.</p>
        </div>
      </div>

      <div className="level-grid">
        <LevelProgress profile={profiles.Yorki} />
        <LevelProgress profile={profiles.Yisel} />
      </div>

      <section className="papipoints-rules-card">
        <button
          className="papipoints-rules-toggle"
          type="button"
          aria-expanded={showRules}
          onClick={() => setShowRules((current) => !current)}
        >
          <span>
            <strong>ⓘ ¿Cómo funcionan los Papipuntos?</strong>
            <small>Consulta cuánto ganas, cuánto pierdes y cómo valorar una recompensa.</small>
          </span>
          <b>{showRules ? "−" : "+"}</b>
        </button>

        {showRules && (
          <div className="papipoints-rules-content">
            <div className="papipoints-rule-section rule-positive">
              <h3>Ganar Papipuntos</h3>
              <div className="papipoints-rule-table">
                <div className="rule-table-header">
                  <span>Prioridad</span><span>Completar</span><span>Antes de tiempo</span><span>Máx. manual</span>
                </div>
                {priorityRuleRows.map(({ key, label }) => (
                  <div className="rule-table-row" key={key}>
                    <strong>{label}</strong>
                    <span>+{COMPLETION_POINTS[key]}</span>
                    <span>+{EARLY_COMPLETION_BONUS[key]}</span>
                    <b>
                      +{COMPLETION_POINTS[key] + EARLY_COMPLETION_BONUS[key] + TASK_CREATION_POINTS}
                    </b>
                  </div>
                ))}
              </div>
              <small>
                Una tarea manual elegible suma +{TASK_CREATION_POINTS} PP adicionales al completarse. Las tareas compartidas otorgan el resultado correspondiente a ambos usuarios.
              </small>
            </div>

            <div className="papipoints-rule-section rule-negative">
              <h3>Perder Papipuntos</h3>
              <div className="papipoints-rule-table compact-rule-table">
                <div className="rule-table-header"><span>Prioridad</span><span>Vencida por día</span></div>
                {priorityRuleRows.map(({ key, label }) => (
                  <div className="rule-table-row" key={key}>
                    <strong>{label}</strong>
                    <b>−{OVERDUE_PENALTY[key]} PP/día</b>
                  </div>
                ))}
              </div>
              <small>
                Una tarea que ya recibió penalizaciones por vencimiento no otorga Papipuntos al completarse. Si se pospone y vuelve a vencerse, puede acumular nuevas penalizaciones.
              </small>
              <small>
                Las tareas de penalización tienen {PENALTY_TASK_GRACE_MINUTES} minutos de gracia. Después descuentan −{PENALTY_TASK_POINTS_PER_HOUR} PP por cada hora iniciada hasta que se resuelven; no otorgan recompensa y el saldo puede quedar en negativo.
              </small>
              <small>
                En recompensas vencidas, cada día transfiere el 10% del costo original desde quien debe entregarla hacia quien la solicitó. Los Papipuntos pueden quedar en negativo.
              </small>
            </div>

            <div className="papipoints-rule-section reward-value-reference">
              <h3>Referencia para valorar recompensas</h3>
              <div className="reward-value-bands">
                <span><b>50–100 PP</b><small>Pequeña · ≈ 5–10 tareas normales</small></span>
                <span><b>150–250 PP</b><small>Mediana · ≈ 15–25 tareas normales</small></span>
                <span><b>300–500 PP</b><small>Importante · ≈ 30–50 tareas normales</small></span>
                <span><b>500+ PP</b><small>Especial</small></span>
              </div>
              <small>Son referencias, no límites. El costo real lo decide la persona que tendrá que entregar la recompensa.</small>
            </div>
          </div>
        )}
      </section>

      {pendingForMe.length > 0 && (
        <section className="task-list-panel reward-pending-panel">
          <div className="list-heading">
            <div>
              <h2>Recompensas que debes configurar</h2>
              <small>{partner.name} está esperando que definas el costo y el tiempo de entrega.</small>
            </div>
            <span>{pendingForMe.length}</span>
          </div>
          <div className="reward-list">
            {pendingForMe.map((reward) => (
              <article className="reward-card reward-pending" key={reward.id}>
                <div>
                  <span className="reward-status-pill">PENDIENTE</span>
                  <strong>{reward.name}</strong>
                  {reward.description && <p>{reward.description}</p>}
                </div>
                {configuringId === reward.id ? (
                  <div className="reward-config-grid">
                    <label className="field">
                      <span>Costo en Papipuntos</span>
                      <input type="number" min="1" inputMode="numeric" value={configCost} onChange={(e) => setConfigCost(e.target.value)} />
                    </label>
                    <label className="field">
                      <span>Días para entregarla</span>
                      <input type="number" min="1" max="365" inputMode="numeric" value={configDays} onChange={(e) => setConfigDays(e.target.value)} />
                    </label>
                    <RewardPricingGuide cost={Number(configCost) || 1} />
                    <div className="reward-actions">
                      <button className="button button-primary" type="button" onClick={() => void configure(reward)}>Guardar configuración</button>
                      <button className="button button-quiet" type="button" onClick={() => setConfiguringId(null)}>Volver</button>
                    </div>
                  </div>
                ) : (
                  <div className="reward-actions">
                    <button className="button button-primary" type="button" onClick={() => startConfigure(reward)}>Configurar</button>
                    <button className="button button-quiet danger-action" type="button" onClick={() => void onRejectReward(reward.id).then(() => onMessage("Recompensa rechazada."))}>Rechazar</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {activeClaims.length > 0 && (
        <section className="task-list-panel reward-active-claims-panel">
          <div className="list-heading">
            <div>
              <h2>Canjes activos</h2>
              <small>Las recompensas pendientes de entrega y sus fechas límite.</small>
            </div>
            <span>{activeClaims.length}</span>
          </div>
          <div className="reward-list">
            {activeClaims.map((claim) => {
              const requester = getAppUserByUid(claim.requesterUserId);
              const provider = getAppUserByUid(claim.providerUserId);
              const isProvider = claim.providerUserId === currentUser.uid;
              const isRequester = claim.requesterUserId === currentUser.uid;
              return (
                <article className="reward-card reward-claim-card" key={claim.id}>
                  <div>
                    <span className="reward-status-pill reward-status-active">🎁 POR ENTREGAR</span>
                    <strong>{claim.rewardName}</strong>
                    {claim.rewardDescription && <p>{claim.rewardDescription}</p>}
                    {claim.purchaseComment && (
                      <div className="reward-purchase-comment">
                        <span>Comentario al canjear</span>
                        <p>{claim.purchaseComment}</p>
                      </div>
                    )}
                    <small>Solicitada por {requester?.name} · La entrega {provider?.name} · Límite: {formatDueDate(claim.dueDate)}</small>
                  </div>
                  <b>{claim.cost} PP</b>
                  <div className="reward-actions">
                    {isProvider && <button className="button button-primary" type="button" disabled={processingId === claim.id} onClick={() => void completeClaim(claim)}>{processingId === claim.id ? "Procesando…" : "Marcar como entregada"}</button>}
                    {isRequester && <button className="button button-quiet danger-action" type="button" disabled={processingId === claim.id} onClick={() => void cancelClaim(claim)}>Cancelar canje</button>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="papipoints-layout">
        <section className="task-list-panel reward-catalog-panel">
          <div className="list-heading">
            <div>
              <h2>Mis recompensas disponibles</h2>
              <small>Tu saldo: {currentProfile.balance} Papipuntos</small>
            </div>
            <span>{availableForMe.length}</span>
          </div>
          <div className="reward-list">
            {availableForMe.length ? availableForMe.map((reward) => (
              <article className="reward-card" key={reward.id}>
                <div>
                  <strong>{reward.name}</strong>
                  {reward.description && <p>{reward.description}</p>}
                  <small>{reward.fulfillmentDays} {reward.fulfillmentDays === 1 ? "día" : "días"} para que {partner.name} la entregue · atraso: {Math.max(1, Math.ceil((reward.cost || 0) * 0.1))} PP/día.</small>
                </div>
                <b>{reward.cost} Papipuntos</b>
                <div className="reward-actions">
                  <button className="button button-primary" type="button" disabled={processingId === reward.id || activeClaimRewardIds.has(reward.id) || currentProfile.balance < (reward.cost || 0)} onClick={() => openRedeemDialog(reward)}>{processingId === reward.id ? "Procesando…" : activeClaimRewardIds.has(reward.id) ? "Canje activo" : "Canjear"}</button>
                  <button className="button button-quiet" type="button" onClick={() => editReward(reward)}>Editar solicitud</button>
                  <button className="button button-quiet danger-action" type="button" onClick={() => void removeReward(reward)}>Eliminar</button>
                </div>
              </article>
            )) : <p className="list-empty">Todavía no tienes recompensas configuradas y disponibles.</p>}
          </div>
        </section>

        <form className="task-list-panel reward-form" onSubmit={saveReward}>
          <div className="list-heading">
            <h2>{editingReward ? "Editar recompensa deseada" : "Proponer recompensa"}</h2>
          </div>
          <p className="reward-form-help">Define lo que quieres. {partner.name} decidirá el costo en Papipuntos y cuántos días tendrá para entregarlo.</p>
          <label className="field">
            <span>Nombre</span>
            <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ej.: Masaje de 30 minutos" />
          </label>
          <label className="field">
            <span>Descripción</span>
            <textarea rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <div className="form-actions">
            {editingReward && <button className="button button-secondary" type="button" onClick={resetForm}>Cancelar edición</button>}
            <button className="button button-primary" type="submit" disabled={saving}>{saving ? "Guardando…" : editingReward ? "Guardar y solicitar nueva configuración" : "Solicitar recompensa"}</button>
          </div>
        </form>
      </div>

      <section className="task-list-panel">
        <div className="list-heading">
          <div>
            <h2>Mis solicitudes</h2>
            <small>Estado de las recompensas que has propuesto.</small>
          </div>
          <span>{myRewards.length}</span>
        </div>
        <div className="reward-list">
          {myRewards.map((reward) => (
            <article className={`reward-card ${reward.status === "rejected" ? "reward-inactive" : ""}`} key={reward.id}>
              <div>
                <span className="reward-status-pill">{reward.status === "pending_configuration" ? "PENDIENTE" : reward.status === "available" ? "DISPONIBLE" : "RECHAZADA"}</span>
                <strong>{reward.name}</strong>
                {reward.status === "available" && <small>{reward.cost} PP · {reward.fulfillmentDays} {reward.fulfillmentDays === 1 ? "día" : "días"}</small>}
              </div>
              <div className="reward-actions">
                <button className="button button-quiet" type="button" onClick={() => editReward(reward)}>Editar</button>
                <button className="button button-quiet danger-action" type="button" onClick={() => void removeReward(reward)}>Eliminar</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {configuredByMe.length > 0 && (
        <section className="task-list-panel">
          <div className="list-heading">
            <div><h2>Recompensas que configuraste</h2><small>Puedes ajustar el costo y tiempo mientras no haya un canje activo afectado; cada canje conserva una copia de las condiciones originales.</small></div>
            <span>{configuredByMe.length}</span>
          </div>
          <div className="reward-list">
            {configuredByMe.map((reward) => (
              <article className="reward-card" key={reward.id}>
                <div><strong>{reward.name}</strong><small>{reward.cost} PP · {reward.fulfillmentDays} {reward.fulfillmentDays === 1 ? "día" : "días"}</small></div>
                <div className="reward-actions"><button className="button button-quiet" type="button" onClick={() => startConfigure(reward)}>Cambiar costo/tiempo</button></div>
                {configuringId === reward.id && (
                  <div className="reward-config-grid">
                    <label className="field"><span>Costo</span><input type="number" min="1" value={configCost} onChange={(e) => setConfigCost(e.target.value)} /></label>
                    <label className="field"><span>Días</span><input type="number" min="1" max="365" value={configDays} onChange={(e) => setConfigDays(e.target.value)} /></label>
                    <RewardPricingGuide cost={Number(configCost) || 1} />
                    <div className="reward-actions"><button className="button button-primary" type="button" onClick={() => void configure(reward)}>Guardar</button><button className="button button-quiet" type="button" onClick={() => setConfiguringId(null)}>Volver</button></div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {claimHistory.length > 0 && (
        <section className="task-list-panel">
          <div className="list-heading"><div><h2>Historial de canjes</h2><small>Recompensas entregadas o canceladas.</small></div><span>{claimHistory.length}</span></div>
          <div className="reward-list">
            {claimHistory.map((claim) => (
              <article className="reward-card reward-inactive" key={claim.id}>
                <div><strong>{claim.rewardName}</strong><small>{claim.status === "completed" ? "Entregada" : `Cancelada · reembolso ${claim.refundAmount || 0} PP`} · {formatDate(claim.updatedAt)}</small></div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="task-list-panel papipoints-history">
        <div className="list-heading">
          <div><h2>Historial de {currentUser.name}</h2><small>Los últimos 50 movimientos de Papipuntos.</small></div>
          <span>{userTransactions.length}</span>
        </div>
        {userTransactions.length ? (
          <div className="transaction-list">
            {userTransactions.map((transaction) => (
              <article className="transaction-row" key={transaction.id}>
                <span className={transaction.amount >= 0 ? "transaction-positive" : "transaction-negative"}>{transaction.amount >= 0 ? "+" : ""}{transaction.amount}</span>
                <div><strong>{transactionTypeLabels[transaction.type]}</strong><small>{transaction.description} · {formatDate(transaction.createdAt)}</small></div>
              </article>
            ))}
          </div>
        ) : <p className="list-empty">Todavía no hay movimientos de Papipuntos.</p>}
      </section>

      {redeemingReward && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeRedeemDialog}>
          <section
            className="action-confirm-modal reward-redeem-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reward-redeem-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">Confirmar canje</span>
            <h2 id="reward-redeem-title">{redeemingReward.name}</h2>
            <div className="action-confirm-copy">
              <p>Costará <b>{redeemingReward.cost || 0} Papipuntos</b>. {partner.name} tendrá <b>{redeemingReward.fulfillmentDays} {redeemingReward.fulfillmentDays === 1 ? "día" : "días"}</b> para entregarla.</p>
              {getLevelFromPapipoints(currentProfile.balance - (redeemingReward.cost || 0)) < currentProfile.level && (
                <p>Tu nivel bajará de {currentProfile.level} a {getLevelFromPapipoints(currentProfile.balance - (redeemingReward.cost || 0))}.</p>
              )}
              <p>Si se vence, cada día de atraso transferirá {Math.max(1, Math.ceil((redeemingReward.cost || 0) * 0.1))} Papipuntos de {partner.name} hacia ti.</p>
            </div>
            <label className="field reward-redeem-comment-field">
              <span>Comentario para {partner.name} <small>(opcional)</small></span>
              <textarea
                rows={4}
                maxLength={500}
                value={redeemComment}
                onChange={(event) => setRedeemComment(event.target.value)}
                placeholder="Ej.: Si puedes, prefiero hacerlo después de las 7:00 p. m."
              />
              <small>Este comentario pertenece únicamente a este canje y aparecerá en la recompensa prioritaria que debe entregar {partner.name}.</small>
            </label>
            <div className="action-confirm-buttons">
              <button className="button button-primary" type="button" disabled={processingId === redeemingReward.id} onClick={() => void redeem()}>
                {processingId === redeemingReward.id ? "Procesando…" : "Confirmar canje"}
              </button>
              <button className="button button-quiet" type="button" disabled={processingId === redeemingReward.id} onClick={closeRedeemDialog}>Volver</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
