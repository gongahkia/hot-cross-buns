package workapp

import "github.com/gongahkia/hot-cross-buns/internal/knowledge"

type RecallStatus struct {
	PersonalSummary          []string
	HistoryEmbeddings        bool
	LearnFromChats           bool
	ReferToChats             bool
	Provider, State, Detail  string
	Storage, Retrieval, Chat string
	Ready                    bool
}

type KnowledgeItem struct {
	SelectionReason                                                      string
	SourceReviewNeeded                                                   bool
	ID, Kind, Title, Text, Scope, Source, Updated, CurrentText, Revision string
	Available                                                            bool
	EvidenceID                                                           string
	UnavailableReason                                                    string
}

type ContextState struct {
	RecallTrace                                        []knowledge.RecallTrace
	WorkID, GoalID, Outcome, Permission, Recall, Usage string
	Items                                              []KnowledgeItem
	Sources                                            []string
}
