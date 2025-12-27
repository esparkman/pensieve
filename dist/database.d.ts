export interface Decision {
    id?: number;
    topic: string;
    decision: string;
    rationale?: string;
    alternatives?: string;
    decided_at?: string;
    source?: string;
}
export interface Preference {
    id?: number;
    category: string;
    key: string;
    value: string;
    notes?: string;
    updated_at?: string;
}
export interface Discovery {
    id?: number;
    category: string;
    name: string;
    location?: string;
    description?: string;
    metadata?: string;
    discovered_at?: string;
    confidence?: number;
}
export interface Entity {
    id?: number;
    name: string;
    description?: string;
    relationships?: string;
    attributes?: string;
    location?: string;
    updated_at?: string;
}
export interface Session {
    id?: number;
    started_at?: string;
    ended_at?: string;
    summary?: string;
    work_in_progress?: string;
    next_steps?: string;
    key_files?: string;
    tags?: string;
}
export interface OpenQuestion {
    id?: number;
    question: string;
    context?: string;
    status?: string;
    resolution?: string;
    created_at?: string;
    resolved_at?: string;
}
export declare class MemoryDatabase {
    private db;
    private projectPath;
    constructor(projectPath?: string);
    private getDbPath;
    private initSchema;
    addDecision(decision: Decision): number;
    searchDecisions(query: string): Decision[];
    getRecentDecisions(limit?: number): Decision[];
    setPreference(pref: Preference): void;
    getPreference(category: string, key: string): Preference | undefined;
    getPreferencesByCategory(category: string): Preference[];
    getAllPreferences(): Preference[];
    addDiscovery(discovery: Discovery): number;
    searchDiscoveries(query: string): Discovery[];
    getDiscoveriesByCategory(category: string): Discovery[];
    upsertEntity(entity: Entity): void;
    getEntity(name: string): Entity | undefined;
    getAllEntities(): Entity[];
    startSession(): number;
    endSession(sessionId: number, summary: string, workInProgress?: string, nextSteps?: string, keyFiles?: string[], tags?: string[]): void;
    getLastSession(): Session | undefined;
    getCurrentSession(): Session | undefined;
    addQuestion(question: string, context?: string): number;
    resolveQuestion(id: number, resolution: string): void;
    getOpenQuestions(): OpenQuestion[];
    search(query: string): {
        decisions: Decision[];
        discoveries: Discovery[];
        entities: Entity[];
    };
    getPath(): string;
    close(): void;
}
