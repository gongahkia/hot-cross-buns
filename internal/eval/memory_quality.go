package eval

// MemoryQualityTrial describes observed behavior, not a model's confidence or
// the number of rows written. Live and deterministic runners use the same score.
type MemoryQualityTrial struct {
	ID             string `json:"id"`
	Important      bool   `json:"important"`
	Captured       bool   `json:"captured"`
	RecallExpected bool   `json:"recall_expected"`
	Applied        bool   `json:"applied"`
	Forbidden      bool   `json:"forbidden"`
	Resurfaced     bool   `json:"resurfaced"`
	Tokens         int64  `json:"tokens"`
	Milliseconds   int64  `json:"milliseconds"`
}

type MemoryQuality struct {
	Trials                 int     `json:"trials"`
	UsefulCaptures         int     `json:"useful_captures"`
	UnnecessaryCaptures    int     `json:"unnecessary_captures"`
	ImportantOmissions     int     `json:"important_omissions"`
	CorrectApplications    int     `json:"correct_applications"`
	MissedApplications     int     `json:"missed_applications"`
	IrrelevantApplications int     `json:"irrelevant_applications"`
	ForbiddenResurfacing   int     `json:"forbidden_resurfacing"`
	Precision              float64 `json:"capture_precision"`
	Recall                 float64 `json:"capture_recall"`
	Tokens                 int64   `json:"tokens"`
	Milliseconds           int64   `json:"milliseconds"`
}

func ScoreMemoryQuality(trials []MemoryQualityTrial) MemoryQuality {
	r := MemoryQuality{Trials: len(trials)}
	for _, t := range trials {
		switch {
		case t.Important && t.Captured:
			r.UsefulCaptures++
		case t.Important:
			r.ImportantOmissions++
		case t.Captured:
			r.UnnecessaryCaptures++
		}
		if t.RecallExpected {
			if t.Applied {
				r.CorrectApplications++
			} else {
				r.MissedApplications++
			}
		} else if t.Applied {
			r.IrrelevantApplications++
		}
		if t.Forbidden && t.Resurfaced {
			r.ForbiddenResurfacing++
		}
		r.Tokens += t.Tokens
		r.Milliseconds += t.Milliseconds
	}
	if n := r.UsefulCaptures + r.UnnecessaryCaptures; n > 0 {
		r.Precision = float64(r.UsefulCaptures) / float64(n)
	}
	if n := r.UsefulCaptures + r.ImportantOmissions; n > 0 {
		r.Recall = float64(r.UsefulCaptures) / float64(n)
	}
	return r
}
