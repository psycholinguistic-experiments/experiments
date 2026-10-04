# Association task (FAST): the carry-over models with random slopes per student.
#
# The results page fits random intercepts only (students, seeds, chains). This
# script adds each student's own slopes for previous state and language, as a
# robustness check. Download "Transitions (CSV)" from the Association task tab,
# then run:
#
#   Rscript materials/fast/random-slopes.R lt5461-association-transitions-<session>.csv
#
# The logistic fit takes a few minutes with a full class.
#
# It tries correlated slopes first; if that fit is singular or does not
# converge, it drops the correlations (||) and keeps that fit if it
# converges, even when some variance is estimated at zero (the variance
# components are printed, so you can see which). If that fails too, it says so.
suppressMessages({ library(lme4); library(lmerTest) })
d <- read.csv(commandArgs(TRUE)[1])
d$student  <- paste(d$pid, d$session)
d$chain    <- paste(d$student, d$seed)
d$lang_c   <- ifelse(d$language == "en", 0.5, -0.5)          # English − Chinese
d$prev_c   <- ifelse(d$previous_state2 == "P", 0.5, -0.5)    # positive − negative
d$next_pos <- as.integer(d$next_state2 == "P")
d$seedv_c  <- d$seed_valence - mean(d$seed_valence)
d$pos_c    <- as.integer(sub("-.*", "", d$transition)) - 5
d$block_c  <- ifelse(d$block == 2, 0.5, -0.5)
d$prevv_c  <- d$previous_valence - 5
cat(sprintf("%d transitions, %d students, %d seeds\n", nrow(d), length(unique(d$student)), length(unique(d$seed))))

# lme4 lists a singular fit among its messages too; only the others mean no convergence
converged <- function(m) !is.null(m) && !any(!grepl("singular", m@optinfo$conv$lme4$messages))
first_good <- function(fits) {
  ks <- names(fits)
  for (i in seq_along(ks)) {
    last <- i == length(ks)
    m <- tryCatch(suppressMessages(suppressWarnings(fits[[ks[i]]]())), error = function(e) NULL)
    if (converged(m) && (last || !isSingular(m))) {
      cat("Random effects:", ks[i], if (isSingular(m)) "(singular: some variance is zero)" else "", "\n")
      print(VarCorr(m), comp = "Std.Dev.")
      return(m)
    }
    cat("Random effects:", ks[i], "— singular or not converged, simplifying\n")
  }
  NULL
}
show <- function(m, terms) {
  s <- summary(m)$coefficients
  print(round(s[intersect(terms, rownames(s)), , drop = FALSE], 4))
}

cat("\n== Model A: next answer positive (logistic) ==\n")
fA <- next_pos ~ lang_c * prev_c + seedv_c + pos_c + block_c
ctl <- glmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 2e5))
mA <- first_good(list(
  "correlated slopes (1 + prev_c + lang_c | student)" = function() glmer(update(fA, . ~ . + (1 + prev_c + lang_c | student) + (1 | seed) + (1 | chain)), d, binomial, control = ctl),
  "uncorrelated slopes (1 + prev_c + lang_c || student)" = function() glmer(update(fA, . ~ . + (1 + prev_c + lang_c || student) + (1 | seed) + (1 | chain)), d, binomial, control = ctl)))
if (!is.null(mA)) {
  show(mA, c("lang_c:prev_c", "lang_c", "prev_c"))
  b <- fixef(mA); V <- as.matrix(vcov(mA))
  for (w in list(c(name = "After a negative answer, English − Chinese", k = -0.5), c(name = "After a positive answer, English − Chinese", k = 0.5))) {
    L <- setNames(rep(0, length(b)), names(b)); L["lang_c"] <- 1; L["lang_c:prev_c"] <- as.numeric(w["k"])
    est <- sum(L * b); se <- sqrt(drop(t(L) %*% V %*% L))
    cat(sprintf("%s: %.3f log-odds (SE %.3f), z = %.2f, p = %.4f\n", w["name"], est, se, est / se, 2 * pnorm(-abs(est / se))))
  }
} else cat("No random-slope model could be fitted with these data.\n")

cat("\n== Model A, continuous: next answer's valence (linear, Satterthwaite) ==\n")
fC <- next_valence ~ lang_c * prevv_c + seedv_c + pos_c + block_c
mC <- first_good(list(
  "correlated slopes (1 + prevv_c + lang_c | student)" = function() lmer(update(fC, . ~ . + (1 + prevv_c + lang_c | student) + (1 | seed) + (1 | chain)), d),
  "uncorrelated slopes (1 + prevv_c + lang_c || student)" = function() lmer(update(fC, . ~ . + (1 + prevv_c + lang_c || student) + (1 | seed) + (1 | chain)), d)))
if (!is.null(mC)) show(mC, c("lang_c:prevv_c", "lang_c", "prevv_c")) else cat("No random-slope model could be fitted with these data.\n")
