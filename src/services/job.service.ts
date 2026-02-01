type JobStatus = "pending" | "processing" | "done" | "failed";

const jobs = new Map<string, any>();

export function createJob(id: string) {
  jobs.set(id, { status: "pending" });
}

export function updateJob(id: string, data: any) {
  jobs.set(id, { ...jobs.get(id), ...data });
}

export function getJob(id: string) {
  return jobs.get(id);
}
