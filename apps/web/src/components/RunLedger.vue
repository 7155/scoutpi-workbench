<template>
  <div class="run-ledger">
    <div v-if="!jobs.length" class="empty">No runs for this plan.</div>
    <button v-for="job in jobs" :key="job.jobId" class="run-row" @click="$emit('select', job)">
      <span :class="['state-dot', job.state]"></span>
      <span class="run-main"><strong>{{ job.mode.replace('_', ' ') }}</strong><small>{{ formatTime(job.updatedAt) }}</small></span>
      <span :class="['state-label', job.state]">{{ job.state.replace('_', ' ') }}</span>
      <code>{{ job.jobId }}</code>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { EarthJob } from "../types";
defineProps<{ jobs: EarthJob[] }>();
defineEmits<{ select: [job: EarthJob] }>();
function formatTime(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
</script>

<style scoped>
.run-ledger { display: grid; }
.run-row { display: grid; grid-template-columns: 10px 1fr auto; gap: 5px 9px; align-items: center; border: 0; border-bottom: 1px solid #e1e6e3; padding: 10px 2px; background: transparent; text-align: left; cursor: pointer; }
.run-row:hover { background: #f5f7f5; }
.run-main { display: flex; justify-content: space-between; gap: 8px; }.run-main small { color: #748079; }
.run-row code { grid-column: 2 / -1; overflow: hidden; color: #7a857f; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.state-dot { width: 8px; height: 8px; border-radius: 50%; background: #87928c; }.state-dot.completed { background: #2f7d59; }.state-dot.failed, .state-dot.blocked_auth { background: #a54450; }.state-dot.running { background: #d18b36; }.state-dot.cancelled { background: #68756e; }
.state-label { color: #68756e; font-size: 10px; text-transform: uppercase; }.state-label.completed { color: #2f7d59; }.state-label.failed, .state-label.blocked_auth { color: #a54450; }.state-label.running { color: #9a661f; }
.empty { padding: 28px 0; color: #7a857f; text-align: center; }
</style>
