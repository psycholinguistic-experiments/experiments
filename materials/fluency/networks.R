# LT5461 fluency task: the group-level semantic networks of the results page,
# rebuilt in R with SemNeT (2.0.0) from the page's downloads.
#
# Input: the two "matrix" CSVs from the results page (Fluency task tab):
#   lt5461-fluency-animals-matrix-<class>.csv, lt5461-fluency-fruitveg-matrix-<class>.csv
#   (one row per student: pid, je5, ds5, je, ds, profile, profile_from, then one
#   0/1 column per word, with the page's Count and Curiosity settings).
# Output: network-measures.csv, network-nodes.csv, network-edges.csv next to the inputs.
#
# Steps (as the page): for the whole class and for each of the four curiosity
# profiles, the words given by at least 2 of the group's students
# (finalize(minimum_cases = 2)); the four profiles equated to their shared
# words (equate()); cosine similarity (similarity(method = "cosine")); TMFG.
# Measures of the unweighted network: ASPL, CC and Q. SemNeT's q() runs its
# Louvain with a seed; semnetmeas() passes none, so it seeds from the clock and
# Q changes slightly from run to run. Here Q uses seed 1 (as the page), and the
# range over seeds 1-100 is reported too.
#
# Usage: Rscript networks.R <folder with the two matrix CSVs>

suppressMessages(library(SemNeT))
invisible(Sys.setlocale("LC_CTYPE", "en_US.UTF-8"))   # the word columns are Chinese
args <- commandArgs(trailingOnly = TRUE)
folder <- if (length(args)) args[1] else "."

profiles <- c("hiD-hiJ" = "High D · high J", "hiD-loJ" = "High D · low J", "loD-hiJ" = "Low D · high J", "loD-loJ" = "Low D · low J")
q_seed <- function(A, seed) SemNeT:::q(SemNeT:::binarize(A), seed = seed)

network <- function(m) {
  S <- similarity(m, method = "cosine")
  A <- suppressWarnings(TMFG(S))
  B <- SemNeT:::binarize(A); diag(B) <- 0
  qs <- vapply(1:100, function(s) q_seed(A, s), numeric(1))
  meas <- semnetmeas(A, meas = c("ASPL", "CC"), weighted = FALSE)
  L <- SemNeT:::louvain(B, seed = 1)
  list(A = A, students = nrow(m), nodes = ncol(A), edges = sum(B[upper.tri(B)] != 0),
       aspl = unname(meas["ASPL"]), cc = unname(meas["CC"]), q = qs[1], q_min = min(qs), q_max = max(qs),
       communities = max(L$membership), membership = L$membership, share = colMeans(m), degree = colSums(B))
}

all_meas <- list(); all_nodes <- list(); all_edges <- list()
for (cat in c("animals", "fruitveg")) {
  file <- list.files(folder, pattern = paste0("^lt5461-fluency-", cat, "-matrix-.*\\.csv$"), full.names = TRUE)
  if (!length(file)) { message("No ", cat, " matrix in ", folder); next }
  d <- read.csv(file[1], check.names = FALSE, fileEncoding = "UTF-8-BOM")
  names(d) <- enc2utf8(names(d))                                  # mark the word columns as UTF-8 (needed by sort)
  info <- c("pid", "je5", "ds5", "je", "ds", "profile", "profile_from")
  words <- sort(setdiff(names(d), info), method = "radix")       # code-point order, as the page
  X <- as.matrix(d[, words, drop = FALSE]); rownames(X) <- d$pid
  nets <- list(class = network(finalize(X, 2)))
  fin <- lapply(names(profiles), function(p) finalize(X[d$profile == p, , drop = FALSE], 2))
  names(fin) <- gsub("-", "_", names(profiles))
  eq <- do.call(equate, fin)
  for (i in seq_along(profiles)) nets[[names(profiles)[i]]] <- network(eq[[i]])
  for (key in names(nets)) {
    n <- nets[[key]]; name <- if (key == "class") "Whole class" else profiles[[key]]
    all_meas[[length(all_meas) + 1]] <- data.frame(category = cat, network = key, group = name, students = n$students, nodes = n$nodes, edges = n$edges,
      cc = round(n$cc, 4), aspl = round(n$aspl, 4), q_seed1 = round(n$q, 4), q_min_seeds_1_100 = round(n$q_min, 4), q_max_seeds_1_100 = round(n$q_max, 4), communities_seed1 = n$communities)
    all_nodes[[length(all_nodes) + 1]] <- data.frame(category = cat, network = key, node = colnames(n$A), share = round(n$share, 4), degree = n$degree, community_seed1 = n$membership)
    e <- which(n$A != 0 & upper.tri(n$A), arr.ind = TRUE)
    all_edges[[length(all_edges) + 1]] <- data.frame(category = cat, network = key, from = colnames(n$A)[e[, 1]], to = colnames(n$A)[e[, 2]], cosine = round(n$A[e], 6))
  }
}
meas <- do.call(rbind, all_meas)
write.csv(meas, file.path(folder, "network-measures.csv"), row.names = FALSE, fileEncoding = "UTF-8")
write.csv(do.call(rbind, all_nodes), file.path(folder, "network-nodes.csv"), row.names = FALSE, fileEncoding = "UTF-8")
write.csv(do.call(rbind, all_edges), file.path(folder, "network-edges.csv"), row.names = FALSE, fileEncoding = "UTF-8")
print(meas, row.names = FALSE)
